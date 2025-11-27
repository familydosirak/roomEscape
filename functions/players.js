// functions/players.js

/* eslint-disable linebreak-style */
/* eslint-disable require-jsdoc */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// ❗ 여기서는 initializeApp() 호출 안 함
//    index.js에서 이미 해줄 거라서, 우리는 그냥 getFirestore()만 나중에 사용

// 공통으로 쓸 헬퍼
function getDb() {
    return getFirestore(); // index.js에서 초기화된 default app 기준
}

const PLAYER_MODE_ENABLED = true;

/**
 * 참가자 선등록 모드일 때, 해당 sessionId가 유효한지 검사
 * - PLAYER_MODE_ENABLED 가 false면 항상 true
 * - true일 때는 sessions 문서에 playerCode가 있어야 허용
 * @param {string} sessionId
 * @return {Promise<boolean>}
 */
async function ensureSessionAllowed(sessionId) {
    if (!PLAYER_MODE_ENABLED) return true;
    if (!sessionId) return false;

    const db = getDb();
    const sessionsRef = db.collection("sessions");

    const doc = await sessionsRef.doc(sessionId).get();
    if (!doc.exists) return false;

    const data = doc.data() || {};
    // 참가자 등록이 된 세션인지 확인
    return !!data.playerCode;
}

/**
 * 참가자 선등록 API
 * POST /api/registerPlayer
 * body: { sessionId, playerCode }
 *
 * - players 컬렉션에 미리 등록된 playerCode(문서 ID)가 있어야 함
 * - 한 playerCode당 처음 한 번만 sessionId를 연결
 *   (이미 다른 sessionId로 사용중이면 에러)
 * - sessions 컬렉션에 playerCode / playerName / playerTeam 저장
 */
const registerPlayer = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            // 모드가 꺼져 있으면 클라이언트에게 알려줌 (클라에서 이 기능 스킵)
            if (!PLAYER_MODE_ENABLED) {
                return res.json({
                    ok: false,
                    code: "PLAYER_MODE_DISABLED",
                    message: "참가자 사전등록 모드가 비활성화되어 있습니다.",
                });
            }

            const body = req.body || {};
            const sessionId = (body.sessionId || "").toString().trim();
            const playerCode = (body.playerCode || "").toString().trim();

            if (!sessionId) {
                return res.status(400).json({
                    ok: false,
                    message: "sessionId가 필요합니다.",
                });
            }

            if (!playerCode) {
                return res.status(400).json({
                    ok: false,
                    needsReset: true,
                    message: "참가자 이름/코드를 입력해주세요.",
                });
            }

            // ❗ 여기에서야 비로소 Firestore를 가져옴
            const db = getDb();
            const sessionsRef = db.collection("sessions");
            const playersRef = db.collection("players");

            // players 컬렉션에서 참가자 찾기 (문서 ID = playerCode 라고 가정)
            const playerDocRef = playersRef.doc(playerCode);
            const playerSnap = await playerDocRef.get();

            if (!playerSnap.exists) {
                return res.status(404).json({
                    ok: false,
                    code: "PLAYER_NOT_FOUND",
                    message: "참가 명단에 없는 이름입니다. (예: 1-정호진)",
                });
            }

            const playerData = playerSnap.data() || {};
            const existingSessionId = (playerData.sessionId || "").toString().trim();
            const now = FieldValue.serverTimestamp();

            // 이미 다른 sessionId로 사용 중이면 막기
            if (existingSessionId && existingSessionId !== sessionId) {
                return res.status(409).json({
                    ok: false,
                    code: "PLAYER_ALREADY_USED",
                    message: "이미 다른 기기에서 사용된 참가자 이름입니다.",
                });
            }

            // players 문서 업데이트 (이 참가자 → 이 브라우저 세션)
            await playerDocRef.set(
                {
                    code: playerCode,
                    name: playerData.name || playerCode,
                    team: playerData.team || null,
                    sessionId,
                    used: true,
                    registeredAt: playerData.registeredAt || now,
                    lastSeenAt: now,
                },
                { merge: true },
            );

            // sessions 문서에도 참가자 정보 연결
            await sessionsRef.doc(sessionId).set(
                {
                    playerCode,
                    playerName: playerData.name || playerCode,
                    playerTeam: playerData.team || null,
                    // 세션이 처음 만들어지는 상황일 수도 있으니 currentStage도 기본값 1
                    currentStage: 1,
                    createdAt: now,
                },
                { merge: true },
            );

            return res.json({
                ok: true,
                playerCode,
                playerName: playerData.name || playerCode,
                playerTeam: playerData.team || null,
            });
        } catch (e) {
            console.error("registerPlayer error:", e);
            return res.status(500).json({
                ok: false,
                message: "참가자 등록 중 서버 오류가 발생했습니다.",
            });
        }
    },
);

// 외부에서 쓸 것들 export
module.exports = {
    PLAYER_MODE_ENABLED,
    ensureSessionAllowed,
    registerPlayer,
};

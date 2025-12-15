/* eslint-disable linebreak-style */
/* eslint-disable require-jsdoc */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const problems = require("./problems"); // 분리된 문제 정의

const { PLAYER_MODE_ENABLED, ensureSessionAllowed, registerPlayer } = require("./players");

if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = getFirestore();

const sessionsRef = db.collection("sessions");
const stageStatsRef = db.collection("stageStats");
const stageClearsRef = db.collection("stageClears");
const choiceRoundsRef = db.collection("choiceRounds");
const playersRef = db.collection("players");

const nicknameRegex = /^[가-힣a-zA-Z0-9_ ]+$/; // 닉네임 정규식: 한글, 영어, 숫자, 언더바, 공백 허용

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mensaparty2025"; // 원하는 비번으로 변경



console.log("### PLAYER_MODE_ENABLED =", PLAYER_MODE_ENABLED);

/**
 * 특정 스테이지를 클리어한 인원 수(= 도착 순위)를 가져온다.
 * @param {number} stage
 * @return {Promise<number>}
 */
async function getStageClearCount(stage) {
    if (!stage) return 0;

    const doc = await stageStatsRef.doc(String(stage)).get();
    if (!doc.exists) return 0;

    const data = doc.data() || {};
    return Number(data.clearCount || 0);
}

/**
 * 세션의 현재 스테이지를 조회한다.
 * 문서가 없으면 생성하고 1을 반환한다.
 * @param {string} sessionId
 * @param {string} nickname (optional)
 * @return {Promise<number>}
 */
async function getCurrentStage(sessionId, nickname) {
    if (!sessionId) return 1;

    const docRef = sessionsRef.doc(sessionId);
    const doc = await docRef.get();

    if (!doc.exists) {
        await docRef.set(
            {
                currentStage: 1,
                createdAt: FieldValue.serverTimestamp(),
                ...(nickname
                    ? {
                        nickname,
                        nicknameUpdatedAt: FieldValue.serverTimestamp(),
                    }
                    : {}),
            },
            { merge: true },
        );
        return 1;
    }

    const data = doc.data() || {};

    // 닉네임이 새로 들어왔고, 기존에 없으면 저장
    if (nickname && !data.nickname) {
        await docRef.set(
            {
                nickname,
                nicknameUpdatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    }

    return data.currentStage || 1;
}

/**
 * 세션의 현재 스테이지를 갱신한다.
 * @param {string} sessionId
 * @param {number} newStage
 * @return {Promise<void>}
 */
async function updateStage(sessionId, newStage) {
    if (!sessionId) return;
    await sessionsRef.doc(sessionId).set(
        {
            currentStage: newStage,
            updatedAt: FieldValue.serverTimestamp(),

        },
        { merge: true },
    );
}

/**
 * 사용자가 입력한 정답 문자열을 정규화한다.
 * @param {string} str
 * @return {string}
 */
function normalizeAnswer(str) {
    return (str || "").toString().trim().toLowerCase();
}

/**
 * 스테이지 번호로 문제를 찾는다.
 * @param {number} stage
 * @return {object|undefined}
 */
function findProblem(stage) {
    return problems.find((p) => p.stage === Number(stage));
}
/**
 * 문제 조회 API
 * GET /api/problem?stage=1&sessionId=xxx&nickname=yyy
 */
exports.problem = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "GET") {
            return res
                .status(405)
                .json({ ok: false, message: "GET만 가능합니다." });
        }

        try {
            const rawStage = Number(req.query.stage || 1);
            const sessionId = req.query.sessionId || "";
            const nickname = (req.query.nickname || "").toString().trim(); // ✅ 닉네임 쿼리

            const allowed = await ensureSessionAllowed(sessionId);
            if (!allowed) {
                return res.status(403).json({
                    ok: false,
                    code: "PLAYER_REG_REQUIRED",
                    message: "참가자 등록을 먼저 진행해주세요.",
                });
            }

            const currentStage = await getCurrentStage(sessionId, nickname); // ✅ 닉네임 전달

            // stage=0 이면 "상태만 조회" (문제 내용 X)
            if (rawStage <= 0) {
                const currentProblem = findProblem(currentStage);
                if (!currentProblem) {
                    // 현재 스테이지에 해당하는 문제가 없다 → 전부 클리어
                    return res.json({
                        ok: true,
                        finished: true,
                        currentStage,
                        message: "모든 문제를 클리어했습니다!",
                        clearImageUrl: "/img/clear.png",
                    });
                }

                // 아직 풀 문제 남음
                return res.json({
                    ok: true,
                    finished: false,
                    currentStage,
                });
            }

            const stage = rawStage;

            // 아직 도달하지 않은 스테이지면 막기
            if (stage > currentStage) {
                return res.status(403).json({
                    ok: false,
                    message: "아직 이 단계에 접근할 수 없습니다.",
                    currentStage,
                });
            }

            const problem = findProblem(stage);

            // 더 이상 문제가 없으면 클리어
            if (!problem) {
                return res.json({
                    ok: true,
                    finished: true,
                    message: "모든 문제를 클리어했습니다!",
                    currentStage,
                    clearImageUrl: "/img/clear.png",
                });
            }

            const isCleared = stage < currentStage;

            // 정답은 "이미 클리어한 문제"에서만 내려보내기
            const payload = {
                ok: true,
                stage: problem.stage,
                type: problem.type || "INPUT",
                title: problem.title,
                imageUrl: problem.imageUrl,
                description: problem.description,
                finished: false,
                currentStage,
                isCleared,
            };

            // 선택/탭/분기 설정도 그대로 내려주기
            if (problem.options) {
                payload.options = problem.options;
            }
            if (problem.tapConfig) {
                payload.tapConfig = problem.tapConfig;
            }
            if (problem.choiceConfig) {
                payload.choiceConfig = problem.choiceConfig;
            }
            if (problem.patternConfig) {
                payload.patternConfig = problem.patternConfig;
            }
            if (problem.mazeConfig) {
                payload.mazeConfig = problem.mazeConfig;
            }

            payload.arrivalRank = await getStageClearCount(stage);

            if (isCleared) {
                payload.answer = problem.answer;
            }

            return res.json(payload);
        } catch (e) {
            console.error(e);
            return res
                .status(500)
                .json({ ok: false, message: "서버 오류가 발생했습니다." });
        }
    },
);

/**
 * 정답 제출 API
 * POST /api/answer { sessionId, stage, answer }
 */
exports.answer = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const { sessionId, stage, answer } = req.body || {};
            const stageNum = Number(stage);

            if (!sessionId || !stageNum || typeof answer !== "string") {
                return res.status(400).json({
                    ok: false,
                    message: "sessionId, stage, answer가 필요합니다.",
                });
            }

            const allowed = await ensureSessionAllowed(sessionId);
            if (!allowed) {
                return res.status(403).json({
                    ok: false,
                    code: "PLAYER_REG_REQUIRED",
                    message: "참가자 등록을 먼저 진행해주세요.",
                });
            }

            const currentStage = await getCurrentStage(sessionId);

            // 아직 도달 못한 스테이지에 대한 제출 막기
            if (stageNum > currentStage) {
                return res.status(403).json({
                    ok: false,
                    message: "먼저 이전 문제를 풀어야 합니다.",
                    currentStage,
                });
            }

            // 이미 클리어한 문제에 대한 제출이면 → 그냥 "이미 클리어" 응답
            if (stageNum < currentStage) {
                return res.json({
                    ok: true,
                    correct: true,
                    alreadyCleared: true,
                    message: "이미 클리어한 문제입니다.",
                    currentStage,
                });
            }

            const problem = findProblem(stageNum);
            if (!problem) {
                return res
                    .status(404)
                    .json({ ok: false, message: "존재하지 않는 문제입니다." });
            }

            const type = (problem.type || "INPUT").toUpperCase();

            // ✅ UPDOWN 타입: 숫자 비교로 힌트 내려주기
            if (type === "UPDOWN") {
                const guess = Number(String(answer).trim());
                const target = Number(String(problem.answer).trim());

                if (!Number.isFinite(guess)) {
                    return res.json({
                        ok: true,
                        correct: false,
                        hint: "INVALID",
                        message: "숫자만 입력해주세요.",
                        currentStage,
                    });
                }

                if (guess === target) {
                    // 정답 처리 → 아래 공통 정답 로직으로 이어지게
                } else {
                    const hint = guess < target ? "UP" : "DOWN";
                    return res.json({
                        ok: true,
                        correct: false,
                        hint, // "UP" | "DOWN"
                        message: hint === "UP" ? "UP (더 큰 수)" : "DOWN (더 작은 수)",
                        currentStage,
                    });
                }
            }

            // ✅ 기본 타입: 기존대로 문자열 비교
            const isCorrect =
                normalizeAnswer(answer) === normalizeAnswer(problem.answer);

            if (!isCorrect) {
                return res.json({
                    ok: true,
                    correct: false,
                    message: "틀렸습니다. 다시 한 번 생각해보세요.",
                    currentStage,
                });
            }

            // 정답인 경우
            const nextStageNum = stageNum + 1;
            const newStage = Math.max(currentStage, nextStageNum);
            await updateStage(sessionId, newStage);

            const nextProblem = findProblem(newStage);

            // 🔥 스테이지 도착 순위 + 통계 (다음 스테이지 기준)
            let arrivalRank = 1;
            try {
                await db.runTransaction(async (t) => {
                    const docRef = stageStatsRef.doc(String(stageNum)); // ✅ 현재 스테이지 기준
                    const snap = await t.get(docRef);

                    let clearCount = 0;
                    if (snap.exists && typeof snap.data().clearCount === "number") {
                        clearCount = snap.data().clearCount;
                    }

                    const newCount = clearCount + 1;
                    arrivalRank = newCount;

                    t.set(
                        docRef,
                        {
                            stage: stageNum,
                            clearCount: newCount,
                            updatedAt: FieldValue.serverTimestamp(),
                        },
                        { merge: true },
                    );
                });
            } catch (e) {
                console.error("Failed to update stageStats:", e);
                // 실패해도 게임은 진행되게 두고, arrivalRank는 기본값 1
            }

            try {
                const sessDoc = await sessionsRef.doc(sessionId).get();
                const sessData = sessDoc.exists ? sessDoc.data() || {} : {};
                const nickname = (sessData.nickname || "").toString().trim();

                if (nickname) {
                    const clearDocId = `${stageNum}_${sessionId}`;
                    await stageClearsRef.doc(clearDocId).set(
                        {
                            stage: stageNum,
                            sessionId,
                            nickname,
                            clearedAt: FieldValue.serverTimestamp(),
                        },
                        { merge: true },
                    );
                }
            } catch (e) {
                console.error("Failed to update stageClears:", e);
            }

            // 더 이상 문제가 없으면 → 여기서 바로 클리어 응답
            if (!nextProblem) {
                return res.json({
                    ok: true,
                    correct: true,
                    finished: true,
                    hasNext: false,
                    currentStage: newStage,
                    message: "모든 문제를 클리어했습니다!",
                    clearImageUrl: "/img/clear.png",
                    arrivalRank, // 마지막 방까지 클리어했을 때 도착 순위
                });
            }

            // 다음 문제까지 같이 내려줌
            const nextProblemPayload = {
                stage: nextProblem.stage,
                type: nextProblem.type || "INPUT",
                title: nextProblem.title,
                imageUrl: nextProblem.imageUrl,
                description: nextProblem.description,
            };

            if (nextProblem.options) {
                nextProblemPayload.options = nextProblem.options;
            }
            if (nextProblem.tapConfig) {
                nextProblemPayload.tapConfig = nextProblem.tapConfig;
            }
            if (nextProblem.choiceConfig) {
                nextProblemPayload.choiceConfig = nextProblem.choiceConfig;
            }
            if (nextProblem && nextProblem.mazeConfig) {
                nextProblemPayload.mazeConfig = nextProblem.mazeConfig;
            }

            return res.json({
                ok: true,
                correct: true,
                finished: false,
                hasNext: true,
                currentStage: newStage,
                nextStage: newStage,
                nextProblem: nextProblemPayload,
                arrivalRank,
            });

        } catch (e) {
            console.error(e);
            return res
                .status(500)
                .json({ ok: false, message: "서버 오류가 발생했습니다." });
        }
    },
);


/**
 * 진행도 초기화 API
 * POST /api/reset { sessionId }
 */
exports.reset = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const { sessionId } = req.body || {};
            if (!sessionId) {
                return res
                    .status(400)
                    .json({ ok: false, message: "sessionId가 필요합니다." });
            }

            const allowed = await ensureSessionAllowed(sessionId);
            if (!allowed) {
                return res.status(403).json({
                    ok: false,
                    code: "PLAYER_REG_REQUIRED",
                    message: "참가자 등록을 먼저 진행해주세요.",
                });
            }

            // currentStage를 1로 초기화
            await sessionsRef.doc(sessionId).set(
                {
                    currentStage: 1,
                    resetAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );

            return res.json({
                ok: true,
                currentStage: 1,
                message: "진행도가 초기화되었습니다.",
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({
                ok: false,
                message: "진행도 초기화 중 서버 오류가 발생했습니다.",
            });
        }
    },
);
/**
 * 관리자용 스테이지 통계 조회 API
 * GET /api/admin/stats
 *
 * 각 스테이지별로:
 *  - stage: 스테이지 번호
 *  - title: 문제 제목
 *  - clearedCount: 해당 스테이지를 "누적" 클리어한 인원 수 (stageStats.clearCount)
 *  - challengersCount: 현재 이 문제에 도전 중인 인원 수 (sessions.currentStage == stage)
 *  - challengers: 현재 이 문제에 도전 중인 닉네임 목록
 */
exports.adminStats = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "GET") {
            return res
                .status(405)
                .json({ ok: false, message: "GET만 가능합니다." });
        }

        try {

            const pwd =
                req.get("x-admin-password") || // 헤더 우선
                (req.query.adminPassword || "").toString(); // 혹시 쿼리로 보낼 경우 대비

            if (pwd !== ADMIN_PASSWORD) {
                return res
                    .status(401)
                    .json({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." });
            }
            // 🔹 1) 전체 문제 중 마지막 스테이지 번호 계산
            const maxStage = problems.reduce((max, p) => {
                const s = Number(p.stage || 0);
                return s > max ? s : max;
            }, 0);

            // 🔹 2) stageStats에서 "누적 클리어 인원" 가져오기
            const statsSnap = await stageStatsRef.get();
            const statsMap = {}; // { "1": 3, "2": 5, ... }

            statsSnap.forEach((doc) => {
                const data = doc.data() || {};
                const clearCount = Number(data.clearCount || 0);
                statsMap[doc.id] = clearCount;
            });

            const clearsSnap = await stageClearsRef.get();
            const clearersMap = {};
            const getTime = (ts) => {
                if (!ts) return 0;
                if (typeof ts.toMillis === "function") return ts.toMillis();
                return 0;
            };

            clearsSnap.forEach((doc) => {
                const data = doc.data() || {};
                const stage = Number(data.stage || 0);
                const nickname = (data.nickname || "").toString().trim();
                if (!stage || !nickname) return;

                const key = String(stage);
                if (!clearersMap[key]) clearersMap[key] = [];
                clearersMap[key].push({
                    nickname,
                    clearedAt: data.clearedAt || null,
                });
            });

            // 🔹 3) sessions에서 "현재 도전 중인 인원/닉네임" 집계
            const sessionsSnap = await sessionsRef.get();
            const challengersMap = {};

            sessionsSnap.forEach((doc) => {
                const data = doc.data() || {};
                const currentStage = Number(data.currentStage || 0);
                const nickname = (data.nickname || "").toString().trim();

                if (!nickname) return;
                if (!currentStage || currentStage > maxStage) return;

                const key = String(currentStage);
                if (!challengersMap[key]) {
                    challengersMap[key] = [];
                }

                challengersMap[key].push({
                    nickname,
                    createdAt: data.createdAt || null,
                    updatedAt: data.updatedAt || null,
                });
            });

            // 🔹 4) 문제 순서대로 결과 조합
            const result = problems
                .slice()
                .sort((a, b) => a.stage - b.stage)
                .map((p) => {
                    const s = Number(p.stage);
                    const key = String(s);

                    const clearedCount = statsMap[key] || 0;

                    // ✅ 도전중인 인원: 도착 순(업데이트/생성 시간)대로 정렬
                    const chArr = challengersMap[key] || [];
                    chArr.sort((a, b) => {
                        const timeA = getTime(a.updatedAt || a.createdAt);
                        const timeB = getTime(b.updatedAt || b.createdAt);
                        return timeA - timeB;
                    });
                    const challengers = chArr.map((c) => c.nickname);

                    // ✅ 클리어한 인원: clearedAt 기준으로 정렬
                    const clArr = clearersMap[key] || [];
                    clArr.sort((a, b) => getTime(a.clearedAt) - getTime(b.clearedAt));
                    const clearers = clArr.map((c) => c.nickname);

                    return {
                        stage: s,
                        title: p.title,
                        clearedCount,
                        challengersCount: challengers.length,
                        challengers,
                        clearers, // 🔥 클리어한 사람 목록 (도착 순)
                    };
                });

            return res.json({
                ok: true,
                stages: result,
            });

        } catch (e) {
            console.error(e);
            return res
                .status(500)
                .json({ ok: false, message: "통계를 조회하는 중 오류가 발생했습니다." });
        }
    },
);

/**
 * 관리자용 참가자 명단 CSV 다운로드
 * GET /api/admin/playersExport
 *
 * players 컬렉션 전체를 CSV로 반환
 * 컬럼: code,name,team,sessionId,used,registeredAt,lastSeenAt
 */
exports.adminPlayersExport = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "GET") {
            return res
                .status(405)
                .json({ ok: false, message: "GET만 가능합니다." });
        }

        try {
            const pwd =
                req.get("x-admin-password") ||
                (req.query.adminPassword || "").toString();

            if (pwd !== ADMIN_PASSWORD) {
                return res
                    .status(401)
                    .json({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." });
            }

            const snap = await playersRef.get();

            const rows = [];
            // 헤더
            rows.push([
                "code",
                "name",
                "team",
                "sessionId",
                "used",
            ]);

            const escapeCsv = (v) => {
                if (v == null) return "";
                let s = String(v);
                // " 나 , 가 있으면 "로 감싸고 "를 ""로 이스케이프
                if (s.includes('"') || s.includes(",") || s.includes("\n")) {
                    s = '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
            };

            snap.forEach((doc) => {
                const d = doc.data() || {};
                const code = d.code || doc.id;
                const name = d.name || "";
                const team = d.team || "";
                const sessionId = d.sessionId || "";
                const used = d.used ? "Y" : "N";

                const tsToStr = (ts) => {
                    if (!ts) return "";
                    try {
                        if (typeof ts.toDate === "function") {
                            return ts.toDate().toISOString();
                        }
                    } catch (e) { }
                    return "";
                };

                const registeredAt = tsToStr(d.registeredAt);
                const lastSeenAt = tsToStr(d.lastSeenAt);

                rows.push([
                    code,
                    name,
                    team,
                    sessionId,
                    used,
                ]);
            });

            const csv = rows
                .map((cols) => cols.map(escapeCsv).join(","))
                .join("\r\n");

            res.setHeader(
                "Content-Type",
                "text/csv; charset=utf-8",
            );
            res.setHeader(
                "Content-Disposition",
                'attachment; filename="players.csv"',
            );

            // BOM 붙여서 엑셀에서 한글 안 깨지게
            const bom = "\uFEFF";
            return res.status(200).send(bom + csv);
        } catch (e) {
            console.error(e);
            return res
                .status(500)
                .json({ ok: false, message: "참가자 명단을 내보내는 중 오류가 발생했습니다." });
        }
    },
);

/**
 * 관리자용 참가자 명단 갱신
 * POST /api/admin/playersImport
 *
 * body: { players: [{ code, name, team }] }
 * → 기존 players 컬렉션 전체 삭제 후, 전달된 목록으로 다시 생성
 */
exports.adminPlayersImport = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const pwd =
                req.get("x-admin-password") ||
                (req.query.adminPassword || "").toString();

            if (pwd !== ADMIN_PASSWORD) {
                return res
                    .status(401)
                    .json({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." });
            }

            const body = req.body || {};
            const players = Array.isArray(body.players) ? body.players : [];

            if (!players.length) {
                return res.status(400).json({
                    ok: false,
                    message: "players 배열이 비어 있습니다.",
                });
            }

            // 코드 기본 검증
            const cleaned = [];
            players.forEach((p) => {
                const code = (p.code || "").toString().trim();
                if (!code) return;
                const name = (p.name || "").toString().trim();
                const team = (p.team || "").toString().trim();
                cleaned.push({ code, name, team });
            });

            if (!cleaned.length) {
                return res.status(400).json({
                    ok: false,
                    message: "유효한 code 값이 없습니다.",
                });
            }

            // 🔥 여기서 컬렉션 전체를 새로 구성
            // (인원 수가 500 넘지 않는다고 가정)
            const batch = db.batch();

            // 1) 기존 players 전체 삭제
            const oldSnap = await playersRef.get();
            oldSnap.forEach((doc) => {
                batch.delete(doc.ref);
            });

            // 2) 새 players 추가 (used / sessionId 초기화)
            const now = FieldValue.serverTimestamp();

            cleaned.forEach((p) => {
                const docRef = playersRef.doc(p.code);
                batch.set(docRef, {
                    code: p.code,
                    name: p.name || p.code,
                    team: p.team || null,
                    used: false,
                    sessionId: null,
                    registeredAt: now,
                    lastSeenAt: null,
                });
            });

            await batch.commit();

            return res.json({
                ok: true,
                message: "참가자 명단이 갱신되었습니다.",
                count: cleaned.length,
            });
        } catch (e) {
            console.error(e);
            return res
                .status(500)
                .json({ ok: false, message: "참가자 명단을 갱신하는 중 서버 오류가 발생했습니다." });
        }
    },
);


/**
 * 관리자용 스테이지 통계 초기화 API
 * POST /api/admin/resetStats
 *
 * - stageStats 컬렉션 전체 삭제
 * - stageClears 컬렉션 전체 삭제
 * - sessions 컬렉션 전체 삭제  ➜ 모든 진행/닉네임/choice 상태 초기화
 * - choiceRounds 컬렉션 전체 삭제 ➜ CHOICE 라운드 기록 초기화
 */
exports.adminResetStats = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const pwd =
                req.get("x-admin-password") ||
                (req.query.adminPassword || "").toString();

            if (pwd !== ADMIN_PASSWORD) {
                return res
                    .status(401)
                    .json({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." });
            }

            const batch = db.batch();

            // 1) stageStats 전체 삭제
            const statsSnap = await stageStatsRef.get();
            statsSnap.forEach((doc) => {
                batch.delete(doc.ref);
            });

            // 2) stageClears 전체 삭제
            const clearsSnap = await stageClearsRef.get();
            clearsSnap.forEach((doc) => {
                batch.delete(doc.ref);
            });

            // 3) choiceRounds 전체 삭제 (CHOICE 라운드 정보 초기화)
            const choiceRoundsSnap = await choiceRoundsRef.get();
            choiceRoundsSnap.forEach((doc) => {
                batch.delete(doc.ref);
            });

            // 4) sessions 전체 삭제 (모든 참가자 진행/닉네임/선택 상태 초기화)
            const sessionsSnap = await sessionsRef.get();
            sessionsSnap.forEach((doc) => {
                batch.delete(doc.ref);
            });

            await batch.commit();

            return res.json({
                ok: true,
                message:
                    "스테이지 통계, 클리어 기록, 모든 세션이 초기화되었습니다.",
            });
        } catch (e) {
            console.error(e);
            return res
                .status(500)
                .json({ ok: false, message: "통계 초기화 중 오류가 발생했습니다." });
        }
    },
);


/**
 * 닉네임 설정 / 변경 API
 * POST /api/changeNickname
 * body: { sessionId, nickname }
 *
 * - 닉네임 중복 방지 (다른 sessionId가 같은 닉네임 쓰고 있으면 막음)
 * - sessions 컬렉션에 nickname 저장 / 변경
 * - stageClears 컬렉션에 기록된 nickname도 전부 변경
 */
exports.changeNickname = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const body = req.body || {};
            const sessionId = (body.sessionId || "").toString().trim();
            let nickname = (body.nickname || "").toString();

            if (!sessionId) {
                return res.status(400).json({
                    ok: false,
                    message: "sessionId가 필요합니다.",
                });
            }

            // 1) 공백 정리
            nickname = nickname.replace(/\s+/g, " ").trim();

            if (!nickname) {
                return res.status(400).json({
                    ok: false,
                    message: "닉네임을 입력해주세요.",
                });
            }

            // 2) 길이 제한
            if (nickname.length < 2 || nickname.length > 12) {
                return res.status(400).json({
                    ok: false,
                    message: "닉네임은 최소 2자, 최대 12자까지 가능합니다.",
                });
            }

            // 3) 허용 문자 검사
            if (!nicknameRegex.test(nickname)) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "닉네임은 한글, 영어, 숫자, 언더바(_), 공백만 가능합니다.",
                });
            }

            // 4) 닉네임 중복 체크 (다른 세션이 이미 사용 중인지)
            const dupSnap = await sessionsRef
                .where("nickname", "==", nickname)
                .limit(10)
                .get();

            let duplicated = false;
            dupSnap.forEach((doc) => {
                if (doc.id !== sessionId) {
                    duplicated = true;
                }
            });

            if (duplicated) {
                return res.status(409).json({
                    ok: false,
                    code: "NICKNAME_TAKEN",
                    message:
                        "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.",
                });
            }

            const sessionDocRef = sessionsRef.doc(sessionId);
            const sessionSnap = await sessionDocRef.get();

            const now = FieldValue.serverTimestamp();

            let oldNickname = null;
            let isNewSession = false;

            if (!sessionSnap.exists) {
                // 🔥 세션 문서가 처음 만들어지는 경우
                isNewSession = true;

                await sessionDocRef.set(
                    {
                        currentStage: 1,
                        nickname,
                        createdAt: now,
                        nicknameUpdatedAt: now,
                    },
                    { merge: true },
                );
            } else {
                const sessData = sessionSnap.data() || {};
                oldNickname = (sessData.nickname || "").toString().trim();

                await sessionDocRef.set(
                    {
                        nickname,
                        nicknameUpdatedAt: now,
                    },
                    { merge: true },
                );
            }

            // 🔥 이미 클리어한 스테이지의 닉네임도 전부 바꿔주기
            //    → "기존 세션"일 때만 시도 (최초 생성일 때는 건드릴게 없음)
            if (!isNewSession) {
                try {
                    const clearsSnap = await stageClearsRef
                        .where("sessionId", "==", sessionId)
                        .get();

                    if (!clearsSnap.empty) {
                        const batch = db.batch();
                        clearsSnap.forEach((doc) => {
                            batch.set(
                                doc.ref,
                                {
                                    nickname,
                                    nicknameUpdatedAt: now,
                                },
                                { merge: true },
                            );
                        });
                        await batch.commit();
                    }
                } catch (e) {
                    // 이 부분에서 에러가 나더라도, 닉네임 저장 자체는 성공한 상태이므로
                    // 함수 전체를 죽이지 말고 경고만 찍고 넘어간다.
                    console.error(
                        "Failed to sync nickname to stageClears:",
                        e,
                    );
                }
            }

            return res.json({
                ok: true,
                message: "닉네임이 설정/변경되었습니다.",
                nickname,
                isNewSession,
                oldNickname,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({
                ok: false,
                message: "닉네임 변경 중 서버 오류가 발생했습니다.",
            });
        }
    },
);

/**
 * CHOICE 문제에서 A/B 선택 기록
 * POST /api/choiceVote { sessionId, stage, option }
 */
exports.choiceVote = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const body = req.body || {};
            const sessionId = (body.sessionId || "").toString().trim();
            const stageNum = Number(body.stage);
            const option = (body.option || "").toString().trim();

            if (!sessionId || !stageNum || !option) {
                return res.status(400).json({
                    ok: false,
                    message: "sessionId, stage, option이 필요합니다.",
                });
            }

            // 세션 현재 진행도 확인
            const currentStage = await getCurrentStage(sessionId);

            if (stageNum !== currentStage) {
                return res.status(400).json({
                    ok: false,
                    message: "현재 진행 중인 스테이지에서만 선택할 수 있습니다.",
                    currentStage,
                });
            }

            const problem = findProblem(stageNum);
            if (!problem) {
                return res
                    .status(404)
                    .json({ ok: false, message: "존재하지 않는 문제입니다." });
            }

            if ((problem.type || "INPUT").toUpperCase() !== "CHOICE") {
                return res.status(400).json({
                    ok: false,
                    message: "이 문제는 CHOICE 타입이 아닙니다.",
                });
            }

            const optionIds = (problem.options || []).map((o) => o.id);
            if (!optionIds.includes(option)) {
                return res.status(400).json({
                    ok: false,
                    message: "선택할 수 없는 옵션입니다.",
                });
            }

            const cfg = problem.choiceConfig || {};
            const groupId = cfg.groupId || `stage_${stageNum}`;
            const windowMs = Number(cfg.windowMs || 60000);

            const nowMs = Date.now();
            const roundStartMs = Math.floor(nowMs / windowMs) * windowMs; // 1분 단위로 고정
            const roundId = String(roundStartMs);
            const roundDocId = `${groupId}_${stageNum}_${roundId}`;

            const sessionDocRef = sessionsRef.doc(sessionId);
            const roundDocRef = choiceRoundsRef.doc(roundDocId);

            await db.runTransaction(async (t) => {
                const [sessSnap, roundSnap] = await Promise.all([
                    t.get(sessionDocRef),
                    t.get(roundDocRef),
                ]);

                const sessData = sessSnap.exists ? sessSnap.data() || {} : {};

                // 🔄 멱등성 체크 (같은 라운드, 같은 옵션이면 다시 카운트 안 올림)
                if (
                    sessData.choiceStage === stageNum &&
                    sessData.choiceRoundId === roundId &&
                    sessData.choiceOption === option
                ) {
                    return;
                }

                // 🧾 세션에 선택 정보 기록
                t.set(
                    sessionDocRef,
                    {
                        choiceStage: stageNum,
                        choiceGroupId: groupId,
                        choiceRoundId: roundId,
                        choiceOption: option,
                        choiceVotedAt: FieldValue.serverTimestamp(),
                    },
                    { merge: true },
                );

                // 🧱 라운드 문서가 아직 없으면 → counts 객체 새로 만들기
                if (!roundSnap.exists) {
                    t.set(roundDocRef, {
                        groupId,
                        stage: stageNum,
                        roundId,
                        windowMs,
                        counts: { [option]: 1 },
                        resolved: false,
                        createdAt: FieldValue.serverTimestamp(),
                    });
                    return;
                }

                // 🧱 이미 라운드 문서가 있으면 → counts 객체를 직접 읽어서 +1
                const roundData = roundSnap.data() || {};
                const oldCounts =
                    roundData.counts && typeof roundData.counts === "object"
                        ? roundData.counts
                        : {};

                const newCounts = { ...oldCounts };
                const prev = Number(newCounts[option] || 0);
                newCounts[option] = prev + 1;

                t.set(
                    roundDocRef,
                    {
                        groupId,
                        stage: stageNum,
                        roundId,
                        windowMs,
                        counts: newCounts,
                        // resolved 그대로 유지 (필요하면 roundData.resolved 체크해서 넣어도 됨)
                    },
                    { merge: true },
                );
            });


            const windowEndMs = roundStartMs + windowMs;

            return res.json({
                ok: true,
                mode: "MINORITY_GO_NEXT",
                windowMs,
                roundId,
                windowEndMs,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({
                ok: false,
                message: "선택을 기록하는 중 서버 오류가 발생했습니다.",
            });
        }
    },
);

/**
 * CHOICE 문제 결과 확인
 * POST /api/choiceResult { sessionId }
 *
 * 응답:
 *  - { ok:true, status:"PENDING", waitMs }
 *  - { ok:true, status:"WIN", currentStage, nextStage, finished }
 *  - { ok:true, status:"LOSE", currentStage, winningOption }
 *  - { ok:true, status:"DRAW", currentStage, winningOption:null }
 */
exports.choiceResult = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        if (req.method !== "POST") {
            return res
                .status(405)
                .json({ ok: false, message: "POST만 가능합니다." });
        }

        try {
            const body = req.body || {};
            const sessionId = (body.sessionId || "").toString().trim();

            if (!sessionId) {
                return res.status(400).json({
                    ok: false,
                    message: "sessionId가 필요합니다.",
                });
            }

            const sessionDocRef = sessionsRef.doc(sessionId);
            const sessSnap = await sessionDocRef.get();

            if (!sessSnap.exists) {
                return res.status(404).json({
                    ok: false,
                    message: "세션이 존재하지 않습니다.",
                });
            }

            const sessData = sessSnap.data() || {};
            const stageNum = Number(sessData.choiceStage || 0);
            const groupId = (sessData.choiceGroupId || "").toString();
            const roundId = (sessData.choiceRoundId || "").toString();
            const option = (sessData.choiceOption || "").toString();

            if (!stageNum || !groupId || !roundId || !option) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "현재 대기 중인 CHOICE 선택 정보가 없습니다. 먼저 선택을 완료해주세요.",
                });
            }

            const problem = findProblem(stageNum);
            if (!problem) {
                return res
                    .status(404)
                    .json({ ok: false, message: "존재하지 않는 문제입니다." });
            }

            if ((problem.type || "INPUT").toUpperCase() !== "CHOICE") {
                return res.status(400).json({
                    ok: false,
                    message: "이 문제는 CHOICE 타입이 아닙니다.",
                });
            }

            const cfg = problem.choiceConfig || {};
            const mode = (cfg.mode || "MINORITY_GO_NEXT").toUpperCase();
            const windowMs = Number(cfg.windowMs || 60000);

            const roundStartMs = Number(roundId);
            if (!Number.isFinite(roundStartMs) || roundStartMs <= 0) {
                // roundId가 이상하게 저장된 경우 방어
                return res.status(400).json({
                    ok: false,
                    message: "라운드 정보가 올바르지 않습니다.",
                });
            }

            const windowEndMs = roundStartMs + windowMs;
            const nowMs = Date.now();

            // 아직 집계 시간이 지나지 않음 → 계속 대기
            if (nowMs < windowEndMs) {
                return res.json({
                    ok: true,
                    status: "PENDING",
                    waitMs: windowEndMs - nowMs,
                });
            }

            // 집계 시간 지난 뒤 → 라운드 문서 읽어서 승자 계산
            const roundDocId = `${groupId}_${stageNum}_${roundId}`;
            const roundDocRef = choiceRoundsRef.doc(roundDocId);
            const roundSnap = await roundDocRef.get();

            if (!roundSnap.exists) {
                // 이론상 거의 없겠지만, 방어용으로 PENDING처럼 처리
                return res.json({
                    ok: true,
                    status: "PENDING",
                    waitMs: 5000,
                });
            }

            const roundData = roundSnap.data() || {};
            const rawCounts = roundData.counts || {};

            // counts가 진짜 객체인지 한 번 더 방어
            const counts =
                rawCounts && typeof rawCounts === "object" ? rawCounts : {};

            // 🔥 문제에 정의된 모든 옵션 기준으로 0포함해서 카운트 만들기
            const optionIds = (problem.options || []).map((o) => o.id);
            const countsAll = {};
            optionIds.forEach((id) => {
                countsAll[id] = Number(counts[id] || 0);
            });

            const entriesAll = Object.entries(countsAll); // 예: [["A",1],["B",0]]

            // 전체 투표 수
            const totalVotes = entriesAll.reduce(
                (sum, [, v]) => sum + Number(v || 0),
                0,
            );

            // 이론상 totalVotes가 0인 케이스는 거의 없지만 방어코드
            if (totalVotes <= 0) {
                const nextStageNum = stageNum + 1;
                await updateStage(sessionId, nextStageNum);

                const nextProblem = findProblem(nextStageNum);
                const finished = !nextProblem;

                return res.json({
                    ok: true,
                    status: "WIN",
                    currentStage: nextStageNum,
                    nextStage: nextStageNum,
                    finished,
                    draw: true,
                    reason: "NO_VOTES",
                });
            }

            // 1표 이상 받은 옵션들만
            const positiveEntries = entriesAll.filter(([, v]) => Number(v || 0) > 0);
            const positiveOptionCount = positiveEntries.length;

            // 🔥 한쪽만 선택된 경우 (A:1 B:0, A:2 B:0, A:5 B:0 등 전부 포함)
            //  → 모두 같은 곳을 골랐으므로 "다수"로 보고 전원 탈락(LOSE)
            //  → 아무도 다음 스테이지로 이동하지 않음
            if (positiveOptionCount === 1) {
                const onlyOptionId = positiveEntries[0][0]; // 예: "A"
                const myCount = Number(countsAll[option] || 0);

                if (option === onlyOptionId && myCount > 0) {
                    // 내가 그 유일한(=다수) 옵션을 고른 사람 중 하나
                    return res.json({
                        ok: true,
                        status: "LOSE",
                        currentStage: stageNum,
                        winningOption: null,
                        reason: "ONLY_ONE_OPTION_CHOSEN",
                    });
                } else {
                    // 이론상 거의 없지만, 내가 표를 안 던졌거나 이상한 상태면 무승부 처리
                    const nextStageNum = stageNum + 1;
                    await updateStage(sessionId, nextStageNum);

                    const nextProblem = findProblem(nextStageNum);
                    const finished = !nextProblem;

                    return res.json({
                        ok: true,
                        status: "WIN",
                        currentStage: nextStageNum,
                        nextStage: nextStageNum,
                        finished,
                        draw: true,
                        reason: "ONLY_ONE_OPTION_CHOSEN_BUT_NO_VOTE",
                    });
                }
            }

            // 여기부터는 0도 포함해서 MINORITY/MAJORITY 계산
            let targetCount = null;
            entriesAll.forEach(([, v]) => {
                const c = Number(v || 0);

                if (targetCount == null) {
                    targetCount = c;
                    return;
                }

                if (mode === "MAJORITY_GO_NEXT") {
                    // 다수 통과 모드라면 최댓값 찾기
                    if (c > targetCount) targetCount = c;
                } else {
                    // 기본: MINORITY_GO_NEXT → 최솟값 찾기
                    if (c < targetCount) targetCount = c;
                }
            });

            // targetCount 와 같은 옵션들 모두 찾기
            const winners = entriesAll
                .filter(([, v]) => Number(v || 0) === targetCount)
                .map(([k]) => k);

            // 🔥 동률이면 무승부 => 성공 처리로 다음 스테이지로 보냄
            if (winners.length !== 1) {
                const nextStageNum = stageNum + 1;
                await updateStage(sessionId, nextStageNum);

                const nextProblem = findProblem(nextStageNum);
                const finished = !nextProblem;

                return res.json({
                    ok: true,
                    status: "WIN",          // ✅ WIN으로 내려서 프론트가 확실히 이동하게
                    currentStage: nextStageNum,
                    nextStage: nextStageNum,
                    finished,
                    draw: true,             // (표시용)
                    tie: true,              // (표시용: 너 프론트가 tie 문구 지원함) :contentReference[oaicite:1]{index=1}
                    winningOptions: winners,
                    reason: "TIE",
                });
            }

            const winningOption = winners[0];

            if (Number(countsAll[winningOption] || 0) === 0) {
                const nextStageNum = stageNum + 1;
                await updateStage(sessionId, nextStageNum);

                const nextProblem = findProblem(nextStageNum);
                const finished = !nextProblem;

                return res.json({
                    ok: true,
                    status: "WIN",
                    currentStage: nextStageNum,
                    nextStage: nextStageNum,
                    finished,
                    draw: true,
                    reason: "WINNER_HAS_NO_VOTES",
                });
            }

            // resolved 플래그는 있으면 한 번만 기록
            if (!roundData.resolved) {
                await roundDocRef.set(
                    {
                        resolved: true,
                        winningOption,
                        resolvedAt: FieldValue.serverTimestamp(),
                    },
                    { merge: true },
                );
            }

            const isWin = option === winningOption;

            if (!isWin) {
                // 패배 → 스테이지 그대로 유지
                return res.json({
                    ok: true,
                    status: "LOSE",
                    currentStage: stageNum,
                    winningOption,
                });
            }

            // 승리 → 다음 스테이지로 진행
            const nextStageNum = stageNum + 1;
            await updateStage(sessionId, nextStageNum);

            const nextProblem = findProblem(nextStageNum);
            const finished = !nextProblem;

            return res.json({
                ok: true,
                status: "WIN",
                currentStage: nextStageNum,
                nextStage: nextStageNum,
                finished,
            });
        } catch (e) {
            console.error("choiceResult error:", e);
            return res.status(500).json({
                ok: false,
                message: "CHOICE 결과 확인 중 서버 오류가 발생했습니다.",
            });
        }
    },
);

exports.registerPlayer = registerPlayer;
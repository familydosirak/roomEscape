/* eslint-disable linebreak-style */
/* eslint-disable require-jsdoc */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const problems = require("./problems"); // 분리된 문제 정의

admin.initializeApp();
const db = getFirestore();

const sessionsRef = db.collection("sessions");
const stageStatsRef = db.collection("stageStats");
const stageClearsRef = db.collection("stageClears");

const nicknameRegex = /^[가-힣a-zA-Z0-9_ ]+$/; // 닉네임 정규식: 한글, 영어, 숫자, 언더바, 공백 허용

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mensaparty2025"; // 원하는 비번으로 변경

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
                title: problem.title,
                imageUrl: problem.imageUrl,
                description: problem.description,
                finished: false,
                currentStage,
                isCleared,
            };

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
            return res.json({
                ok: true,
                correct: true,
                finished: false,
                hasNext: true,
                currentStage: newStage,
                nextStage: newStage,
                nextProblem: {
                    stage: nextProblem.stage,
                    title: nextProblem.title,
                    imageUrl: nextProblem.imageUrl,
                    description: nextProblem.description,
                },
                arrivalRank, // 프론트에서 "몇 번째로 도착했어요!" 표시용
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
 * 관리자용 스테이지 통계 초기화 API
 * POST /api/admin/resetStats
 *
 * stageStats 컬렉션을 싹 비움 → 다시 처음부터 1번째 도착
 * (sessions.currentStage 는 건드리지 않음)
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

            // 3) 모든 세션 currentStage를 1로 초기화
            const sessionsSnap = await sessionsRef.get();
            sessionsSnap.forEach((doc) => {
                batch.set(
                    doc.ref,
                    {
                        currentStage: 1,
                        resetAt: FieldValue.serverTimestamp(),
                        resetByAdmin: true,
                    },
                    { merge: true },
                );
            });

            await batch.commit();

            return res.json({
                ok: true,
                message:
                    "스테이지 통계, 닉네임 기록, 모든 참가자의 진행도가 초기화되었습니다.",
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


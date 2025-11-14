/* eslint-disable linebreak-style */
/* eslint-disable require-jsdoc */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const problems = require("./problems"); // 분리된 문제 정의

admin.initializeApp();
const db = admin.firestore();

const sessionsRef = db.collection("sessions");

/**
 * 세션의 현재 스테이지를 조회한다.
 * 문서가 없으면 생성하고 1을 반환한다.
 * @param {string} sessionId
 * @return {Promise<number>}
 */
async function getCurrentStage(sessionId) {
    if (!sessionId) return 1;

    const doc = await sessionsRef.doc(sessionId).get();
    if (!doc.exists) {
        await sessionsRef.doc(sessionId).set(
            {
                currentStage: 1,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
        return 1;
    }
    const data = doc.data() || {};
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
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
 * GET /api/problem?stage=1&sessionId=xxx
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
            const currentStage = await getCurrentStage(sessionId);

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
                });
            }

            // 다음 문제까지 같이 내려줌 (프론트가 바로 그릴 수 있게)
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
                    resetAt: admin.firestore.FieldValue.serverTimestamp(),
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

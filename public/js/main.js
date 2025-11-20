// public/js/main.js

// 브라우저마다 고유 sessionId 생성해서 localStorage에 저장
let sessionId = localStorage.getItem("escapeSessionId");
if (!sessionId) {
    sessionId =
        "sess_" +
        Math.random().toString(36).slice(2) +
        Date.now().toString(36);
    localStorage.setItem("escapeSessionId", sessionId);
}

// ✅ 스테이지별 "내 도착 순위" & 문제 캐시
let stageRanks = {};
let stageCache = {};

try {
    const storedRanks = localStorage.getItem("escapeStageRanks");
    if (storedRanks) {
        stageRanks = JSON.parse(storedRanks) || {};
    }
} catch (e) {
    stageRanks = {};
}

try {
    const storedCache = localStorage.getItem("escapeStageProblems");
    if (storedCache) {
        stageCache = JSON.parse(storedCache) || {};
    }
} catch (e) {
    stageCache = {};
}

function saveStageRanks() {
    try {
        localStorage.setItem("escapeStageRanks", JSON.stringify(stageRanks));
    } catch (e) {
        console.warn("failed to save ranks", e);
    }
}

function saveStageCache() {
    try {
        localStorage.setItem("escapeStageProblems", JSON.stringify(stageCache));
    } catch (e) {
        console.warn("failed to save cache", e);
    }
}

let finishedState = null;

try {
    const storedFinished = localStorage.getItem("escapeFinishedInfo");
    if (storedFinished) {
        finishedState = JSON.parse(storedFinished) || null;
    }
} catch (e) {
    finishedState = null;
}

function saveFinishedState(state) {
    finishedState = state;
    try {
        if (state) {
            localStorage.setItem("escapeFinishedInfo", JSON.stringify(state));
        } else {
            localStorage.removeItem("escapeFinishedInfo");
        }
    } catch (e) {
        console.warn("failed to save finished state", e);
    }
}

// 현재 보고 있는 스테이지 (화면에 표시 중인 방 번호)
let currentStage = 1;
// 서버 기준으로 "다음에 풀 스테이지" (진행도)
let maxUnlockedStage = 1;
// 지금 화면이 "클리어 화면"인지 여부
let isFinished = false;

// 🔥 쿨타임 관련 전역 상태
let baseCooldown = 10;      // 기본 쿨타임 (초)
let nextCooldown = 10;      // 다음 오답 때 적용될 쿨타임
let cooldownUntil = null;   // 쿨타임 종료 시각 (timestamp ms)
let cooldownStage = null;   // 쿨타임이 걸려있는 스테이지 번호
let wrongCooldown = null;   // setInterval 핸들

// 🔥 쿨타임 상태 저장/복구
function saveCooldownState() {
    try {
        if (cooldownUntil && cooldownStage != null) {
            localStorage.setItem(
                "escapeCooldown",
                JSON.stringify({
                    cooldownUntil,
                    cooldownStage,
                    nextCooldown,
                })
            );
        } else {
            localStorage.removeItem("escapeCooldown");
        }
    } catch (e) {
        console.warn("failed to save cooldown", e);
    }
}

// 앱 로드 시 쿨타임 복원
try {
    const storedCooldown = localStorage.getItem("escapeCooldown");
    if (storedCooldown) {
        const parsed = JSON.parse(storedCooldown);
        if (
            parsed &&
            typeof parsed.cooldownUntil === "number" &&
            typeof parsed.cooldownStage === "number"
        ) {
            if (parsed.cooldownUntil > Date.now()) {
                cooldownUntil = parsed.cooldownUntil;
                cooldownStage = parsed.cooldownStage;
                if (typeof parsed.nextCooldown === "number") {
                    nextCooldown = parsed.nextCooldown;
                }
            } else {
                // 이미 지난 쿨타임이면 무시
                cooldownUntil = null;
                cooldownStage = null;
                nextCooldown = baseCooldown;
                localStorage.removeItem("escapeCooldown");
            }
        }
    }
} catch (e) {
    cooldownUntil = null;
    cooldownStage = null;
    nextCooldown = baseCooldown;
}

const mainScreen = document.getElementById("main-screen");
const gameScreen = document.getElementById("game-screen");
const startBtn = document.getElementById("start-btn");

const stageInfoEl = document.getElementById("stage-info");
const titleEl = document.getElementById("problem-title");
const imgEl = document.getElementById("problem-image");
const descEl = document.getElementById("problem-desc");
const answerInput = document.getElementById("answer-input");
const submitBtn = document.getElementById("submit-btn");
const resultEl = document.getElementById("result-message");
const finishEl = document.getElementById("finish-message");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const inputRow = document.querySelector(".input-row");
const resetBtn = document.getElementById("reset-btn");

function updateNavButtons() {
    if (isFinished) {
        const lastStage = maxUnlockedStage - 1;
        prevBtn.disabled = lastStage < 1;
        nextBtn.disabled = true;
        return;
    }

    prevBtn.disabled = currentStage <= 1;
    nextBtn.disabled = currentStage >= maxUnlockedStage;
}

function showFinishedScreen(data) {
    isFinished = true;

    if (typeof data.currentStage === "number") {
        maxUnlockedStage = data.currentStage;
    }

    saveFinishedState({
        currentStage: typeof data.currentStage === "number" ? data.currentStage : maxUnlockedStage,
        message: data.message || "모든 문제를 클리어했습니다!",
        clearImageUrl: data.clearImageUrl || "/img/clear.png",
    });

    stageInfoEl.textContent = "";
    titleEl.textContent = "게임 클리어!";

    imgEl.style.display = "block";
    imgEl.src = data.clearImageUrl || "/img/clear.png";

    descEl.textContent = "";
    resultEl.textContent = "";
    finishEl.textContent =
        data.message || "모든 문제를 클리어했습니다!";

    inputRow.style.display = "none";
    answerInput.disabled = true;
    submitBtn.disabled = true;

    resetBtn.classList.remove("hidden");
    resetBtn.disabled = false;

    updateNavButtons();
}

// 🔥 쿨타임 시작 (특정 스테이지에 대해서만)
function startCooldown(seconds, stage) {
    cooldownStage = stage;
    cooldownUntil = Date.now() + seconds * 1000;
    saveCooldownState();

    // 이전 타이머 정리
    if (wrongCooldown) {
        clearInterval(wrongCooldown);
        wrongCooldown = null;
    }

    const tick = () => {
        const now = Date.now();
        const remaining = Math.ceil((cooldownUntil - now) / 1000);

        const isOnTargetStage =
            !isFinished &&
            currentStage === cooldownStage &&
            currentStage === maxUnlockedStage; // 아직 안 푼 현재 문제

        if (remaining > 0) {
            if (isOnTargetStage) {
                answerInput.disabled = true;
                submitBtn.disabled = true;
                resultEl.style.color = "#f97373";
                resultEl.textContent = `틀렸습니다! (${remaining}초 후 다시 시도 가능)`;
            }
        } else {
            // 쿨타임 종료
            clearInterval(wrongCooldown);
            wrongCooldown = null;
            cooldownUntil = null;

            if (isOnTargetStage) {
                answerInput.disabled = false;
                submitBtn.disabled = false;
                resultEl.style.color = "#ffffff";
                resultEl.textContent = "다시 정답을 입력해보세요!";
                answerInput.focus();
            }

            cooldownStage = null;
            saveCooldownState();
        }
    };

    // 즉시 한 번 실행해서 첫 메시지 표시
    tick();
    wrongCooldown = setInterval(tick, 1000);
}

// 공통 렌더 함수: 문제 데이터를 받아서 화면에 뿌려줌
function renderProblem(problem, options = {}) {
    const { isCleared = false, currentStageFromServer } = options;

    if (typeof currentStageFromServer === "number") {
        maxUnlockedStage = currentStageFromServer;
    }

    isFinished = false;
    resetBtn.classList.add("hidden");
    resetBtn.disabled = true;
    finishEl.textContent = "";

    currentStage = problem.stage;

    // ✅ 라벨: 내 도착 순위 기준으로 표시
    const key = String(problem.stage);
    let rank = problem.arrivalRank;

    if ((typeof rank !== "number" || rank <= 0) &&
        typeof stageRanks[key] === "number" &&
        stageRanks[key] > 0) {
        rank = stageRanks[key];
    }

    let arrivalText = "";
    if (typeof rank === "number" && rank > 0) {
        if (rank === 1) {
            arrivalText = " / 1번째로 도착했어요!";
        } else {
            arrivalText = ` / ${rank}번째로 도착했어요!`;
        }
    }

    stageInfoEl.textContent = `${problem.stage}번 방입니다.${arrivalText}`;

    titleEl.textContent = problem.title || "";
    imgEl.src = problem.imageUrl || "";
    imgEl.style.display = problem.imageUrl ? "block" : "none";
    descEl.textContent = problem.description || "";

    if (isCleared) {
        // ✅ 이미 클리어한 문제는 항상 입력 막고, 메시지도 고정
        inputRow.style.display = "flex";
        answerInput.disabled = true;
        submitBtn.disabled = true;
        if (problem.answer) {
            answerInput.value = problem.answer;
        } else {
            answerInput.value = "";
        }
        resultEl.style.color = "#4ade80";
        resultEl.textContent = "이미 클리어한 문제입니다.";
    } else {
        inputRow.style.display = "flex";
        answerInput.value = "";

        const now = Date.now();

        // ✅ 이 스테이지에 대해서 쿨타임이 남아있는 경우
        if (
            cooldownUntil &&
            cooldownStage === problem.stage &&
            now < cooldownUntil
        ) {
            const remaining = Math.max(
                1,
                Math.ceil((cooldownUntil - now) / 1000)
            );

            answerInput.disabled = true;
            submitBtn.disabled = true;
            resultEl.style.color = "#f97373";
            resultEl.textContent = `틀렸습니다! (${remaining}초 후 다시 시도 가능)`;

            // 혹시 타이머가 끊겨 있으면 여기서 다시 시작
            if (!wrongCooldown) {
                startCooldown(remaining, problem.stage);
            }
        } else {
            // ✅ 쿨타임이 없으면 정상 입력 가능
            cooldownStage = null;
            cooldownUntil = null;
            if (wrongCooldown) {
                clearInterval(wrongCooldown);
                wrongCooldown = null;
            }

            saveCooldownState();

            answerInput.disabled = false;
            submitBtn.disabled = false;
            resultEl.textContent = "";
            answerInput.focus();
        }
    }

    updateNavButtons();
}

// 특정 스테이지 문제를 서버에서 불러오는 함수
async function loadProblem(stage) {
    resultEl.textContent = "";
    resultEl.style.color = "#f97373";
    finishEl.textContent = "";
    isFinished = false;

    resetBtn.classList.add("hidden");
    resetBtn.disabled = true;

    try {
        const res = await fetch(
            `/api/problem?stage=${stage}&sessionId=${encodeURIComponent(
                sessionId
            )}`
        );
        const data = await res.json();

        if (!data.ok) {
            alert(data.message || "이 단계에 접근할 수 없습니다.");
            if (data.currentStage) {
                maxUnlockedStage = data.currentStage;
                loadProblem(data.currentStage);
            }
            return;
        }

        if (typeof data.currentStage === "number") {
            maxUnlockedStage = data.currentStage;
        }

        if (data.finished) {
            showFinishedScreen(data);
            return;
        }

        const problemStage = data.stage;
        const key = String(problemStage);

        const problem = {
            stage: problemStage,
            title: data.title,
            imageUrl: data.imageUrl,
            description: data.description,
            answer: data.answer, // 이미 클리어한 문제의 정답 표시용
        };

        if (typeof stageRanks[key] === "number" && stageRanks[key] > 0) {
            problem.arrivalRank = stageRanks[key];
        } else if (typeof data.arrivalRank === "number" && data.arrivalRank > 0) {
            problem.arrivalRank = data.arrivalRank;
        }

        stageCache[key] = problem;
        saveStageCache();

        renderProblem(problem, {
            isCleared: !!data.isCleared,
            currentStageFromServer: data.currentStage,
        });
    } catch (e) {
        console.error(e);
        alert("문제를 불러오는 중 오류가 발생했습니다.");
    }
}

// ✅ 캐시 우선으로 스테이지 보여주기
// ✅ 게임 전체를 이미 클리어했고,
//    요청한 stage가 "진행도 이상"이면 클리어 화면으로 간 걸로 판단
async function showStage(stage) {
    if (finishedState && typeof maxUnlockedStage === "number") {
        const clearStage = maxUnlockedStage;
        if (stage >= clearStage) {
            showFinishedScreen({
                currentStage: finishedState.currentStage,
                message: finishedState.message,
                clearImageUrl: finishedState.clearImageUrl,
            });
            return;
        }
    }

    const key = String(stage);
    const cached = stageCache[key];

    if (cached) {
        const isCleared = stage < maxUnlockedStage;

        if ((cached.arrivalRank == null || cached.arrivalRank <= 0) &&
            typeof stageRanks[key] === "number" &&
            stageRanks[key] > 0) {
            cached.arrivalRank = stageRanks[key];
        }

        renderProblem(cached, {
            isCleared,
            currentStageFromServer: maxUnlockedStage,
        });
    } else {
        await loadProblem(stage);
    }
}

async function submitAnswer() {
    const answer = answerInput.value.trim();
    if (!answer) {
        resultEl.style.color = "#f97373";
        resultEl.textContent = "정답을 입력해주세요.";
        return;
    }

    try {
        submitBtn.disabled = true;
        answerInput.disabled = true;

        // 버튼 누르자마자 바로 표시
        resultEl.style.color = "#fbbf24";
        resultEl.textContent = "정답 확인 중...";

        const res = await fetch("/api/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, stage: currentStage, answer }),
        });
        const data = await res.json();

        // 1) 서버 자체 오류 응답
        if (!data.ok) {
            submitBtn.disabled = false;
            answerInput.disabled = false;

            alert(data.message || "정답 제출 중 오류가 발생했습니다.");
            return;
        }

        // 2) 이미 클리어한 문제에 대한 제출
        if (data.alreadyCleared) {
            submitBtn.disabled = false;
            answerInput.disabled = false;

            resultEl.style.color = "#4ade80";
            resultEl.textContent =
                data.message || "이미 클리어한 문제입니다.";
            return;
        }

        // 3) 오답
        if (!data.correct) {
            // 이번에 적용할 쿨타임 (기본 10초, 틀릴 때마다 +2초)
            const cooldownSeconds = nextCooldown;
            nextCooldown += 2;

            startCooldown(cooldownSeconds, currentStage);
            return;
        }

        // 4) 정답
        resultEl.style.color = "#4ade80";
        resultEl.textContent = "정답입니다!";

        // 정답 맞추면 쿨타임 상태 초기화
        nextCooldown = baseCooldown;
        cooldownUntil = null;
        cooldownStage = null;
        if (wrongCooldown) {
            clearInterval(wrongCooldown);
            wrongCooldown = null;
        }
        saveCooldownState();

        if (typeof data.currentStage === "number") {
            maxUnlockedStage = data.currentStage;
        }

        // ✅ 내 도착 순위 저장 (해당 방에 처음 도착했을 때만)
        if (typeof data.nextStage === "number" && typeof data.arrivalRank === "number") {
            const key = String(data.nextStage);
            if (stageRanks[key] == null) {
                stageRanks[key] = data.arrivalRank;
                saveStageRanks();
            }
        }

        // ✅ 짧게 "정답입니다!" 보여주고 나서 다음 화면으로 이동
        const goNext = () => {
            if (data.finished) {
                showFinishedScreen(data);
                return;
            }

            if (data.hasNext && data.nextProblem) {
                const np = data.nextProblem;
                const key = String(np.stage);

                const nextProblem = {
                    stage: np.stage,
                    title: np.title,
                    imageUrl: np.imageUrl,
                    description: np.description,
                    answer: np.answer,
                };

                const savedRank = stageRanks[key];
                if (typeof savedRank === "number" && savedRank > 0) {
                    nextProblem.arrivalRank = savedRank;
                }

                stageCache[key] = nextProblem;
                saveStageCache();

                renderProblem(nextProblem, {
                    isCleared: false,
                    currentStageFromServer: data.currentStage,
                });
            } else {
                // 혹시 hasNext 정보가 없으면 안전하게 캐시/서버 통해 재로딩
                showStage(data.nextStage || maxUnlockedStage);
            }
        };

        setTimeout(goNext, 400);
    } catch (e) {
        console.error(e);
        submitBtn.disabled = false;
        answerInput.disabled = false;
        alert("정답 제출 중 오류가 발생했습니다.");
    }
}

// 게임 시작: 상태만 먼저 조회해서 이어하기/클리어 분기
async function startGame() {
    startBtn.disabled = true;

    try {
        if (finishedState) {
            mainScreen.classList.add("hidden");
            gameScreen.classList.remove("hidden");

            showFinishedScreen({
                currentStage: finishedState.currentStage,
                message: finishedState.message,
                clearImageUrl: finishedState.clearImageUrl,
            });
            return;
        }

        const res = await fetch(
            `/api/problem?stage=0&sessionId=${encodeURIComponent(sessionId)}`
        );
        const data = await res.json();

        if (!data.ok) {
            alert(data.message || "게임 상태를 가져오는 중 오류가 발생했습니다.");
            startBtn.disabled = false;
            return;
        }

        if (typeof data.currentStage === "number") {
            maxUnlockedStage = data.currentStage;
        }

        mainScreen.classList.add("hidden");
        gameScreen.classList.remove("hidden");

        if (data.finished) {
            showFinishedScreen(data);
        } else {
            const stageToStart = data.currentStage || 1;
            await loadProblem(stageToStart);
        }
    } catch (e) {
        console.error(e);
        alert("게임을 시작하는 중 오류가 발생했습니다.");
        startBtn.disabled = false;
    }
}

startBtn.addEventListener("click", startGame);
submitBtn.addEventListener("click", submitAnswer);

answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        if (!submitBtn.disabled && !answerInput.disabled) {
            submitAnswer();
        }
    }
});

prevBtn.addEventListener("click", () => {
    if (isFinished) {
        const lastStage = maxUnlockedStage - 1;
        if (lastStage >= 1) {
            isFinished = false;
            showStage(lastStage);
        }
    } else if (currentStage > 1) {
        showStage(currentStage - 1);
    }
});

nextBtn.addEventListener("click", () => {
    if (isFinished) return;
    const nextStage = currentStage + 1;
    if (nextStage <= maxUnlockedStage) {
        showStage(nextStage);
    }
});

async function resetGame() {
    if (!confirm("정말 처음부터 다시 시작할까요?")) {
        return;
    }

    resetBtn.disabled = true;

    try {
        const res = await fetch("/api/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();

        if (!data.ok) {
            alert(data.message || "초기화 중 오류가 발생했습니다.");
            resetBtn.disabled = false;
            return;
        }

        currentStage = 1;
        maxUnlockedStage = 1;
        isFinished = false;

        // ✅ 쿨타임 리셋
        cooldownUntil = null;
        cooldownStage = null;
        nextCooldown = baseCooldown;
        if (wrongCooldown) {
            clearInterval(wrongCooldown);
            wrongCooldown = null;
        }
        saveCooldownState();

        // ✅ 로컬 기록 초기화
        stageRanks = {};
        stageCache = {};
        saveStageRanks();
        saveStageCache();

        saveFinishedState(null);

        finishEl.textContent = "";
        resultEl.textContent = "";
        resetBtn.classList.add("hidden");

        await loadProblem(1);
    } catch (e) {
        console.error(e);
        alert("초기화 중 오류가 발생했습니다.");
        resetBtn.disabled = false;
    }
}

resetBtn.addEventListener("click", resetGame);

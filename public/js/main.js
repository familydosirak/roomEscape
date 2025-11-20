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
    if (data.clearImageUrl) {
        imgEl.src = data.clearImageUrl;
    } else {
        imgEl.src = "/img/clear.png";
    }

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

    // problem에 rank가 없으면 로컬에 저장된 내 순위 사용
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
        answerInput.disabled = false;
        submitBtn.disabled = false;
        answerInput.value = "";
        resultEl.textContent = "";
        answerInput.focus();
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

        // ✅ 내 도착 순위가 저장돼 있으면 그걸 우선 사용
        if (typeof stageRanks[key] === "number" && stageRanks[key] > 0) {
            problem.arrivalRank = stageRanks[key];
        } else if (typeof data.arrivalRank === "number" && data.arrivalRank > 0) {
            // 서버에서 내려준 값(첫 진입 시)을 임시로 표시
            problem.arrivalRank = data.arrivalRank;
        }

        // ✅ 문제 캐시에 저장
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

        // 캐시에 arrivalRank 없으면 stageRanks에서 보완
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
            submitBtn.disabled = false;
            answerInput.disabled = false;

            resultEl.style.color = "#f97373";
            resultEl.textContent =
                data.message || "틀렸습니다. 다시 시도해보세요.";
            return;
        }

        // 4) 정답
        resultEl.style.color = "#4ade80";
        resultEl.textContent = "정답입니다!";

        // 정답인 경우에는 현재 문제에선 더 이상 입력 못 하게 유지
        // (다음 문제로 넘어갈 때 renderProblem이 새로 enable 해줌)

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

        // 🔹 여기 값(예: 400)을 조절해서 보여주는 시간 늘이거나 줄일 수 있음
        setTimeout(goNext, 1000);
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

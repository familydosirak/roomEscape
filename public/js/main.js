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
    stageInfoEl.textContent = `현재 스테이지: ${currentStage}`;
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

        const problem = {
            stage: data.stage,
            title: data.title,
            imageUrl: data.imageUrl,
            description: data.description,
            answer: data.answer, // 이미 클리어한 문제의 정답 표시용
        };

        renderProblem(problem, {
            isCleared: !!data.isCleared,
            currentStageFromServer: data.currentStage,
        });
    } catch (e) {
        console.error(e);
        alert("문제를 불러오는 중 오류가 발생했습니다.");
    }
}

async function submitAnswer() {
    const answer = answerInput.value.trim();
    if (!answer) {
        resultEl.textContent = "정답을 입력해주세요.";
        return;
    }

    try {
        submitBtn.disabled = true;

        const res = await fetch("/api/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, stage: currentStage, answer }),
        });
        const data = await res.json();

        submitBtn.disabled = false;

        if (!data.ok) {
            alert(data.message || "정답 제출 중 오류가 발생했습니다.");
            return;
        }

        if (data.alreadyCleared) {
            resultEl.style.color = "#4ade80";
            resultEl.textContent =
                data.message || "이미 클리어한 문제입니다.";
            return;
        }

        if (!data.correct) {
            resultEl.style.color = "#f97373";
            resultEl.textContent =
                data.message || "틀렸습니다. 다시 시도해보세요.";
            return;
        }

        // 정답 맞음
        resultEl.style.color = "#4ade80";
        resultEl.textContent = "정답입니다!";

        if (typeof data.currentStage === "number") {
            maxUnlockedStage = data.currentStage;
        }

        // 서버에서 "이미 다음 문제 데이터"를 내려줌
        setTimeout(() => {
            if (data.finished) {
                showFinishedScreen(data);
                return;
            }

            if (data.hasNext && data.nextProblem) {
                renderProblem(data.nextProblem, {
                    isCleared: false,
                    currentStageFromServer: data.currentStage,
                });
            } else {
                // 혹시 hasNext 정보가 없으면 안전하게 현재 스테이지 다시 로딩
                loadProblem(data.nextStage || maxUnlockedStage);
            }
        }, 500);
    } catch (e) {
        console.error(e);
        submitBtn.disabled = false;
        alert("정답 제출 중 오류가 발생했습니다.");
    }
}

// 게임 시작: 상태만 먼저 조회해서 이어하기/클리어 분기
async function startGame() {
    startBtn.disabled = true;

    try {
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
            loadProblem(lastStage);
        }
    } else if (currentStage > 1) {
        loadProblem(currentStage - 1);
    }
});

nextBtn.addEventListener("click", () => {
    if (isFinished) return;
    const nextStage = currentStage + 1;
    if (nextStage <= maxUnlockedStage) {
        loadProblem(nextStage);
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

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

window.escapeSessionId = sessionId;


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
let baseCooldown = 5;      // 기본 쿨타임 (초)
let nextCooldown = 5;      // 다음 오답 때 적용될 쿨타임
let cooldownUntil = null;   // 쿨타임 종료 시각 (timestamp ms)
let cooldownStage = null;   // 쿨타임이 걸려있는 스테이지 번호
let wrongCooldown = null;   // setInterval 핸들
let wrongHintText = null;
let wrongHintStage = null;
let currentProblemCtxCleanup = null;
let currentProblemType = "INPUT";
let currentProblemAnswer = "";


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
const nicknameInput = document.getElementById("nickname-input");

const nicknameChangeBtn = document.getElementById("nickname-change-btn");
const nicknameMsg = document.getElementById("nickname-message");

// 참가자 선등록 상태
let playerRegistered =
    localStorage.getItem("escapePlayerRegistered") === "true";

// 참가자 등록 화면 요소
const playerScreen = document.getElementById("player-screen");
const playerInput = document.getElementById("player-name-input");
const playerBtn = document.getElementById("player-confirm-btn");
const playerMsg = document.getElementById("player-message");

const stageInfoEl = document.getElementById("stage-info");
const titleEl = document.getElementById("problem-title");
const imgEl = document.getElementById("problem-image");
const descEl = document.getElementById("problem-desc");
const answerInput = document.getElementById("answer-input");
const submitBtn = document.getElementById("submit-btn");
const testAnswerRow = document.getElementById("test-answer-row");
const showAnswerBtn = document.getElementById("show-answer-btn");
const forceCorrectBtn = document.getElementById("force-correct-btn");
const resultEl = document.getElementById("result-message");
const finishEl = document.getElementById("finish-message");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const inputRow = document.querySelector(".input-row");
const resetBtn = document.getElementById("reset-btn");

let nickname = localStorage.getItem("escapeNickname") || "";
if (nicknameInput && nickname) {
    nicknameInput.value = nickname;
}

function clearPlayerRegistration() {
    try {
        localStorage.removeItem("escapePlayerRegistered");
        localStorage.removeItem("escapePlayerCode");
        localStorage.removeItem("escapePlayerName");

        localStorage.removeItem("escapeFinishedInfo");
        localStorage.removeItem("escapeStageRanks");
        localStorage.removeItem("escapeStageProblems");
        localStorage.removeItem("escapeCooldown");
    } catch (e) {
        console.warn("failed to clear player registration", e);
    }
    playerRegistered = false;
}

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

    // ✅ 클리어 화면은 무조건 라이트 테마
    document.body.classList.add("theme-light");
    // 혹시 남아있을 수 있는 페이드 클래스 정리(안전)
    document.body.classList.remove("fade-start");
    document.body.classList.remove("fade-reveal");
    document.body.classList.remove("theme-fade");


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
    // ✅ 클리어 문구에 이름 + 닉네임 표시
    const playerName = localStorage.getItem("escapePlayerName") || "";
    const nick = nickname || localStorage.getItem("escapeNickname") || "";

    let titleLine = "축하드립니다!";
    if (playerName || nick) {
        titleLine = `[ ${playerName}${playerName && nick ? " - " : ""}${nick} ] 님 축하드립니다`;
    }

    finishEl.innerHTML = `
    <div style="line-height: 1.6;">
        <strong>${titleLine}</strong><br/>
        ${data.message || "모든 문제를 클리어했습니다!"}
    </div>
`;

    inputRow.style.display = "none";
    answerInput.disabled = true;
    submitBtn.disabled = true;

    //resetBtn.classList.remove("hidden");
    //resetBtn.disabled = false;

    updateNavButtons();
}

// 🔥 쿨타임 시작 (특정 스테이지에 대해서만)
function startCooldown(seconds, stage, hintText) {
    wrongHintStage = stage;
    wrongHintText = hintText || null;
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

                const prefix = (wrongHintStage === stage && wrongHintText)
                    ? `${wrongHintText} `
                    : "";

                resultEl.textContent = `${prefix}틀렸습니다! (${remaining}초 후 다시 시도 가능)`;
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

function applyStageThemeWithFade(stage) {
    const willBeLight = Number(stage) >= 8;
    const isLight = document.body.classList.contains("theme-light");

    // ✅ stage8로 넘어가는 순간(다크 -> 라이트)만 연출
    const enteringLight = willBeLight && !isLight;

    // 라이트 유지/다크 유지/라이트->다크는 그냥 즉시 전환(연출 없음)
    if (!enteringLight) {
        document.body.classList.toggle("theme-light", willBeLight);
        return;
    }

    // 1) 오버레이 준비 + "완전 검정" 즉시 덮기
    document.body.classList.add("theme-fade");
    document.body.classList.remove("fade-reveal");
    document.body.classList.add("fade-start");

    // 2) 다음 프레임에 라이트 테마 적용 후, "천천히 밝아지기" 트리거
    requestAnimationFrame(() => {
        document.body.classList.toggle("theme-light", true);

        // ✅ 검정 화면 유지 시간(ms) — 여기만 늘리면 됨
        const holdMs = 400;

        setTimeout(() => {
            document.body.classList.remove("fade-start");
            document.body.classList.add("fade-reveal");

            setTimeout(() => {
                document.body.classList.remove("fade-reveal");
            }, 2300); // (밝아지는 시간 + 약간)
        }, holdMs);
    });
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
    currentProblemType = (problem.type || "INPUT").toUpperCase();
    currentProblemAnswer = problem.answer || "";

    if (testAnswerRow) {
        testAnswerRow.style.display = "flex";
    }

    applyStageThemeWithFade(problem.stage);

    // ✅ 도착 순위 텍스트
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
            arrivalText = "당신은 1번째로 도착했어요!";
        } else {
            arrivalText = `당신은 ${rank}번째로 도착했어요!`;
        }
    }

    //stageInfoEl.textContent = `${problem.stage}번 방입니다.${arrivalText}`;
    stageInfoEl.textContent = `${arrivalText}`;

    // ✅ 여기서 이미지/타이틀/설명 무조건 세팅
    titleEl.textContent = problem.title || "";
    imgEl.src = problem.imageUrl || "";
    imgEl.style.display = problem.imageUrl ? "block" : "none";
    descEl.textContent = problem.description || "";

    // 🔥 타입별 UI를 적용하기 위한 context
    const ctx = {
        inputRow,
        answerInput,
        submitBtn,
        resultEl,
        descEl,
        _cleanup: currentProblemCtxCleanup,
        submitAnswer: (forced) => submitAnswer(forced),
    };

    // ✅ 이전 타입별 UI가 있다면 정리
    if (currentProblemCtxCleanup) {
        try {
            currentProblemCtxCleanup();
        } catch (e) {
            console.warn(e);
        }
        currentProblemCtxCleanup = null;
    }

    if (isCleared) {
        // 이미 클리어한 문제: 항상 인풋 disabled + 정답 보여주기
        inputRow.style.display = "flex";
        answerInput.disabled = true;
        submitBtn.disabled = true;
        if (forceCorrectBtn) forceCorrectBtn.disabled = true;
        if (problem.answer) {
            answerInput.value = problem.answer;
        } else {
            answerInput.value = "";
        }
        resultEl.style.color = "#4ade80";
        resultEl.textContent = "이미 클리어한 문제입니다.";
    } else {
        // 아직 안 푼 문제 + 쿨타임 여부
        const now = Date.now();

        inputRow.style.display = "flex";
        answerInput.value = "";

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

            if (!wrongCooldown) {
                startCooldown(remaining, problem.stage);
            }
        } else {
            cooldownStage = null;
            cooldownUntil = null;
            if (wrongCooldown) {
                clearInterval(wrongCooldown);
                wrongCooldown = null;
            }

            saveCooldownState();

            answerInput.disabled = false;
            submitBtn.disabled = false;
            if (forceCorrectBtn) forceCorrectBtn.disabled = false;
            resultEl.textContent = "";
            answerInput.focus();
        }

        // 🔥 타입별 UI 적용 (INPUT/TAP/CHOICE 등)
        if (window.ProblemTypes && typeof window.ProblemTypes.apply === "function") {
            window.ProblemTypes.apply(problem, ctx);
            currentProblemCtxCleanup = ctx._cleanup || null;
        } else {
            currentProblemCtxCleanup = null;
        }
    }

    updateNavButtons();
}

function updateScreenVisibility() {
    if (!playerScreen || !mainScreen) return;

    if (playerRegistered) {
        // 참가자 등록이 끝났으면 바로 메인 화면
        playerScreen.classList.add("hidden");
        mainScreen.classList.remove("hidden");
    } else {
        // 참가자 등록 전에는 참가자 입력 화면부터
        playerScreen.classList.remove("hidden");
        mainScreen.classList.add("hidden");
    }
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
            // 🔥 참가자 등록이 필요하다고 서버가 알려준 경우
            if (data.code === "PLAYER_REG_REQUIRED") {
                clearPlayerRegistration();  // localStorage 비우고
                saveFinishedState(null);    // 클리어 정보도 초기화
                updateScreenVisibility();   // player-screen 다시 보이게

                // 게임 화면 보고 있었으면 메인으로 돌려보내고 안내
                alert("참가자 등록 정보가 없어 다시 입력이 필요합니다.\n참가자 이름/코드를 다시 입력해주세요.");
            } else {
                // 원래 하던 동작 유지
                alert(data.message || "이 단계에 접근할 수 없습니다.");
                if (data.currentStage) {
                    maxUnlockedStage = data.currentStage;
                    loadProblem(data.currentStage);
                }
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
            type: data.type || "INPUT",
            title: data.title,
            imageUrl: data.imageUrl,
            description: data.description,
            answer: data.answer, // 이미 클리어한 문제의 정답 표시용
            options: data.options || null,
            tapConfig: data.tapConfig || null,
            choiceConfig: data.choiceConfig || null,
            patternConfig: data.patternConfig || null,
            mazeConfig: data.mazeConfig || null,
            flashlightConfig: data.flashlightConfig || null,
            duel: data.duel || null,
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

async function submitAnswer(forcedAnswer) {

    const raw = forcedAnswer != null ? String(forcedAnswer) : answerInput.value;

    const answer = raw.trim();
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

        const url = (currentProblemType === "DUEL") ? "/api/duelSubmit" : "/api/answer";
        const body = (currentProblemType === "DUEL")
            ? { sessionId, code: answer }              // ✅ DUEL
            : { sessionId, stage: currentStage, answer }; // ✅ 기존

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
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

        if (!data.correct) {
            const isUpdown =
                data.hint === "UP" || data.hint === "DOWN" || data.hint === "INVALID";

            // ✅ 업다운은 쿨타임 20초 고정, 그 외는 기존 로직(점점 증가)
            const cooldownSeconds = isUpdown ? 20 : nextCooldown;

            if (!isUpdown) {
                nextCooldown += 1;
            }

            let hintText = null;
            if (data.hint === "UP") hintText = "UP";
            else if (data.hint === "DOWN") hintText = "DOWN";
            else if (data.hint === "INVALID") hintText = "숫자만 입력!";

            startCooldown(cooldownSeconds, currentStage, hintText);
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
                    type: np.type || "INPUT",
                    title: np.title,
                    imageUrl: np.imageUrl,
                    description: np.description,
                    answer: np.answer,
                    options: np.options || null,
                    tapConfig: np.tapConfig || null,
                    choiceConfig: np.choiceConfig || null,
                    patternConfig: np.patternConfig || null,
                    mazeConfig: np.mazeConfig || null,
                    flashlightConfig: np.flashlightConfig || null,
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
        if (!playerRegistered) {
            alert("먼저 참가자 이름/코드를 입력해 주세요.");
            startBtn.disabled = false;
            return;
        }
        // ✅ 규칙 1: 아직 확정된 닉네임이 없으면 게임 시작 불가
        if (!nickname || !nickname.trim()) {
            alert("닉네임을 먼저 설정해주세요!");
            if (nicknameInput) nicknameInput.focus();
            startBtn.disabled = false;
            return;
        }

        // ✅ 여기서는 입력창에 뭐가 적혀있든, "확정된 nickname 변수"만 사용
        //    (닉네임 다시 바꾸고 싶으면 반드시 '닉네임 설정' 버튼을 눌러야 함)

        // 🔥 닉네임은 changeNickname API에서 이미 서버에 반영된 상태라고 가정
        // 굳이 여기서 다시 닉네임을 보낼 필요 없음
        const res = await fetch(
            `/api/problem?stage=0&sessionId=${encodeURIComponent(
                sessionId,
            )}`
        );
        const data = await res.json();

        if (!data.ok) {
            // 🔥 참가자 등록이 필요하다고 서버가 알려주는 경우
            if (data.code === "PLAYER_REG_REQUIRED") {
                clearPlayerRegistration();      // localStorage 비우고
                saveFinishedState(null);    // 클리어 정보도 초기화
                updateScreenVisibility();       // player-screen 다시 보이게
                alert("참가자 등록 정보가 없어 다시 입력이 필요합니다.\n참가자 이름/코드를 다시 입력해주세요.");
            } else {
                alert(data.message || "게임 상태를 가져오는 중 오류가 발생했습니다.");
            }

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

        if (finishedState) {
            saveFinishedState(null);
        }
    } catch (e) {
        console.error(e);
        alert("게임을 시작하는 중 오류가 발생했습니다.");
        startBtn.disabled = false;
    }
}

const nicknameRegex = /^[가-힣a-zA-Z0-9_ ]+$/;

// 🔥 닉네임을 서버에 설정/변경하는 공통 함수
async function applyNickname(rawNick) {
    // 1) 앞뒤 공백 제거 + 연속 공백 1개로 정규화
    let nick = (rawNick || "").toString();
    nick = nick.replace(/\s+/g, " ").trim(); // 여러 칸 공백 → 한 칸, 앞뒤 공백 제거

    // 인풋 박스에도 정리된 값 다시 넣어주기 (사용자 눈에도 통일된 형태로 보이게)
    if (nicknameInput) {
        nicknameInput.value = nick;
    }

    if (!nick) {
        if (nicknameMsg) {
            nicknameMsg.style.color = "#f97373";
            nicknameMsg.textContent = "닉네임을 입력해주세요.";
        }
        return false;
    }

    // 2) 길이 제한: 최소 2자, 최대 12자
    if (nick.length < 2 || nick.length > 12) {
        if (nicknameMsg) {
            nicknameMsg.style.color = "#f97373";
            nicknameMsg.textContent = "닉네임은 최소 2자, 최대 12자까지 가능합니다.";
        }
        return false;
    }

    // 3) 허용 문자 검사
    if (!nicknameRegex.test(nick)) {
        if (nicknameMsg) {
            nicknameMsg.style.color = "#f97373";
            nicknameMsg.textContent = "닉네임은 한글, 영어, 숫자, 언더바(_), 공백만 가능합니다.";
        }
        return false;
    }

    if (nicknameMsg) {
        nicknameMsg.style.color = "#9ca3af";
        nicknameMsg.textContent = "닉네임 확인 중...";
    }

    try {
        const res = await fetch("/api/changeNickname", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, nickname: nick }), // 정리된 nick 사용
        });

        const data = await res.json();

        if (!data.ok) {
            if (nicknameMsg) {
                nicknameMsg.style.color = "#f97373";
                nicknameMsg.textContent =
                    data.message || "닉네임 설정에 실패했습니다.";
            }
            return false;
        }

        // ✅ 여기서만 "확정 닉네임" 업데이트
        nickname = nick;
        localStorage.setItem("escapeNickname", nickname);

        if (nicknameMsg) {
            nicknameMsg.style.color = "#4ade80";
            nicknameMsg.textContent = "닉네임이 설정/변경되었습니다.";
        }

        return true;
    } catch (e) {
        console.error(e);
        if (nicknameMsg) {
            nicknameMsg.style.color = "#f97373";
            nicknameMsg.textContent = "닉네임 변경 중 오류가 발생했습니다.";
        }
        return false;
    }
}

// 🔥 참가자 선등록 API 호출
async function registerPlayer() {
    if (!playerInput || !playerBtn || !playerMsg) return;

    const code = playerInput.value.trim();
    if (!code) {
        playerMsg.style.color = "#f97373";
        playerMsg.textContent = "참가자 이름/코드를 입력해주세요. (예: 1-정호진)";
        playerInput.focus();
        return;
    }

    playerBtn.disabled = true;
    playerMsg.style.color = "#9ca3af";
    playerMsg.textContent = "참가자 확인 중...";

    try {
        const res = await fetch("/api/registerPlayer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, playerCode: code }),
        });

        const data = await res.json();

        // 🔧 서버에서 "모드가 꺼져있다"고 알려준 경우 → 이 기능 스킵
        if (data.code === "PLAYER_MODE_DISABLED") {
            playerRegistered = true;
            localStorage.setItem("escapePlayerRegistered", "true");
            playerMsg.textContent =
                "참가자 사전등록 모드가 비활성화되어 있어 바로 진행합니다.";
            updateScreenVisibility();
            return;
        }

        if (!data.ok) {
            playerMsg.style.color = "#f97373";
            playerMsg.textContent = data.message || "참가자 확인에 실패했습니다.";
            return;
        }



        // 다시 필요한 정보만 저장
        playerRegistered = true;
        localStorage.setItem("escapePlayerRegistered", "true");
        localStorage.setItem("escapePlayerCode", data.playerCode || code);


        // 닉네임도 반드시 새로 입력하도록 초기화
        nickname = "";
        localStorage.removeItem("escapeNickname");
        if (nicknameInput) nicknameInput.value = "";

        if (data.playerName) {
            localStorage.setItem("escapePlayerName", data.playerName);
        }


        playerMsg.style.color = "#4ade80";
        playerMsg.textContent = "참가자 확인이 완료되었습니다!";

        updateScreenVisibility();

    } catch (e) {
        console.error(e);
        playerMsg.style.color = "#f97373";
        playerMsg.textContent = "참가자 등록 중 오류가 발생했습니다.";
    } finally {
        playerBtn.disabled = false;
    }
}

if (playerBtn) {
    playerBtn.addEventListener("click", registerPlayer);
}

if (playerInput) {
    playerInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (!playerBtn.disabled) {
                registerPlayer();
            }
        }
    });
}

startBtn.addEventListener("click", startGame);

if (nicknameChangeBtn) {
    nicknameChangeBtn.addEventListener("click", async () => {
        const nick = nicknameInput ? nicknameInput.value.trim() : "";
        nicknameChangeBtn.disabled = true;
        const ok = await applyNickname(nick);
        nicknameChangeBtn.disabled = false;

        // 닉네임 중복이면 게임 시작 전에 바로 알 수 있음
        if (!ok && nicknameInput) {
            nicknameInput.focus();
        }
    });
}


submitBtn.addEventListener("click", () => submitAnswer());

if (showAnswerBtn) {
    showAnswerBtn.addEventListener("click", () => {
        if (!currentProblemAnswer) {
            resultEl.style.color = "#f97373";
            resultEl.textContent = "현재 문제의 정답 정보가 없습니다.";
            return;
        }

        answerInput.value = currentProblemAnswer;
        resultEl.style.color = "#fbbf24";
        resultEl.textContent = `정답: ${currentProblemAnswer}`;
    });
}

if (forceCorrectBtn) {
    forceCorrectBtn.addEventListener("click", () => {
        if (!currentProblemAnswer) {
            resultEl.style.color = "#f97373";
            resultEl.textContent = "현재 문제의 정답 정보가 없습니다.";
            return;
        }

        answerInput.value = currentProblemAnswer;
        submitAnswer(currentProblemAnswer);
    });
}

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
    if (!confirm("정말 처음부터 다시 시작할까요? 초기화 후 순위가 다시 매겨집니다.")) {
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

// 🔥 참가자 선등록 모드 자동 감지
async function initPlayerMode() {
    // 이미 로컬스토리지에 등록 완료로 찍혀 있으면 굳이 서버 안 두드려도 됨
    if (playerRegistered) {
        return;
    }

    try {
        const res = await fetch("/api/registerPlayer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // PLAYER_MODE_ENABLED=false 인 경우에는 body가 뭐든 상관 없이
            // 바로 PLAYER_MODE_DISABLED 응답을 돌려주므로 sessionId만 보냄
            body: JSON.stringify({ sessionId }),
        });

        const data = await res.json().catch(() => ({}));

        // ✅ 서버에서 "참가자 모드 꺼져 있음"이라고 알려준 경우
        if (data && data.code === "PLAYER_MODE_DISABLED") {
            playerRegistered = true;
            localStorage.setItem("escapePlayerRegistered", "true");

            // 참가자 화면 숨기고 바로 닉네임/시작 화면 보여주기
            updateScreenVisibility();
        }
        // 그 외 (mode 켜져 있거나, playerCode 없어서 400 등)는 그냥 무시 → 기존 로직 유지
    } catch (e) {
        console.error("initPlayerMode error:", e);
        // 에러 났을 때는 그냥 기존 로직 유지 (참가자 화면 보여줌)
    }
}

document.addEventListener("contextmenu", (e) => {
    const img = e.target && e.target.id === "problem-image";
    if (img) e.preventDefault();
}, { capture: true });

updateScreenVisibility();
initPlayerMode();

window.escapeShowStage = showStage;

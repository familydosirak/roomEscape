// public/js/problemTypes.js
(function (global) {
    const ProblemTypes = {};

    /**
     * 공통 유틸: 이전 문제에서 만든 선택 버튼/탭 리스너 등을 제거
     */
    function cleanupPrev(ctx) {
        if (ctx._cleanup && typeof ctx._cleanup === "function") {
            try {
                ctx._cleanup();
            } catch (e) {
                console.warn("cleanup error", e);
            }
        }
        ctx._cleanup = null;
    }

    const CHOICE_STORAGE_KEY = "escapeChoiceState";

    function loadChoiceState() {
        try {
            const raw = localStorage.getItem(CHOICE_STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn("loadChoiceState error", e);
            return null;
        }
    }

    function saveChoiceState(state) {
        try {
            localStorage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("saveChoiceState error", e);
        }
    }

    function clearChoiceState() {
        try {
            localStorage.removeItem(CHOICE_STORAGE_KEY);
        } catch (e) {
            console.warn("clearChoiceState error", e);
        }
    }


    /**
     * 기본 INPUT 형식 (현재 사용중인 텍스트 입력형)
     */
    function setupInput(problem, ctx) {
        cleanupPrev(ctx);

        // 기본 인풋 UI 보이기
        ctx.inputRow.style.display = "flex";
        ctx.answerInput.disabled = false;
        ctx.submitBtn.disabled = false;
        ctx.answerInput.placeholder = "정답을 입력하세요";
        // value는 main.js에서 관리하므로 여기선 건드리지 않아도 됨

        ctx.resultEl.textContent = "";

        ctx._cleanup = function () {
            // 특별히 정리할 것은 없음
        };
    }

    /**
     * 화면 TAP 문제
     * - 특정 횟수만큼 화면을 클릭하면 자동으로 정답 제출
     * - submitAnswer(problem.answer)를 호출해서 서버로 숨겨진 정답 문자열 전송
     */
    function setupTap(problem, ctx) {
        cleanupPrev(ctx);

        // ✅ 정답 입력칸은 그대로 보여야 하니까 건드리지 않음
        // ctx.inputRow.style.display = "none";  // 이건 절대 쓰지 말기!

        const cfg = problem.tapConfig || {};
        const requiredTaps = cfg.requiredTaps || 5;
        const resetAfterMs = cfg.resetAfterMs || 5000; // 기본 5초

        const gameScreen = document.getElementById("game-screen");
        let count = 0;
        let firstTapTime = 0;  // 첫 터치 시각

        function onTap(e) {

            if (ctx.answerInput.disabled || ctx.submitBtn.disabled) {
                return;
            }

            const now = Date.now();

            // 🔥 첫 터치거나, 이전 콤보가 너무 오래되면 → 새 콤보 시작
            if (!firstTapTime || now - firstTapTime > resetAfterMs) {
                firstTapTime = now;
                count = 0;
            }

            count += 1;

            // 👉 터치 횟수/힌트는 일부러 안 보여줌 (속이기용)
            // ctx.resultEl.style.color = "#fbbf24";
            // ctx.resultEl.textContent = `${count} / ${requiredTaps}번 터치했습니다.`;

            if (count >= requiredTaps) {
                // 더 이상 중복 인식 안 되게 이벤트 제거
                gameScreen.removeEventListener("click", onTap);

                ctx.resultEl.style.color = "#4ade80";
                ctx.resultEl.textContent =
                    "무언가 딱 맞아 떨어진 느낌입니다. 다음 방으로 이동합니다.";

                if (typeof ctx.submitAnswer === "function") {
                    const forced = `TAP_${requiredTaps}`; // 서버 정답 규칙
                    ctx.submitAnswer(forced);
                }
            }
        }

        gameScreen.addEventListener("click", onTap);

        ctx._cleanup = function () {
            gameScreen.removeEventListener("click", onTap);
        };
    }



    /**
 * A/B 선택 문제 (MINORITY_GO_NEXT)
 * - 버튼 클릭 시: /api/choiceVote 로 선택 기록
 * - 서버 기준 집계 시간이 끝난 뒤: /api/choiceResult 로 결과 조회
 * - 더 적은 쪽을 고른 사람만 WIN → 다음 스테이지로 이동
 */
    function setupChoice(problem, ctx) {
        cleanupPrev(ctx);

        // 텍스트 입력은 숨기고, 선택 버튼만 사용
        ctx.inputRow.style.display = "none";
        ctx.resultEl.textContent = "";

        const options =
            (problem.options && problem.options.length > 0)
                ? problem.options
                : [
                    { id: "A", label: "A" },
                    { id: "B", label: "B" },
                ];

        const container = document.createElement("div");
        container.className = "choice-row";

        let voted = false;       // 이미 한 번 선택했는지
        let waitTimer = null;    // setTimeout 핸들

        function setButtonsDisabled(disabled) {
            const btns = container.querySelectorAll("button.choice-btn");
            btns.forEach((b) => {
                b.disabled = disabled;
            });
        }

        async function checkResultLoop() {
            try {
                const res = await fetch("/api/choiceResult", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionId: window.escapeSessionId,
                    }),
                });

                const data = await res.json();

                if (!data.ok) {
                    ctx.resultEl.style.color = "#f97373";
                    ctx.resultEl.textContent =
                        data.message || "결과를 확인하는 중 오류가 발생했습니다.";
                    // 다시 선택 가능하게
                    voted = false;
                    setButtonsDisabled(false);
                    clearChoiceState();
                    return;
                }

                if (data.status === "PENDING") {
                    // 아직 집계 시간 전 → 서버가 알려준 대기시간 만큼만 한 번 더 기다렸다 재조회
                    const waitMs = Math.max(2000, Number(data.waitMs || 0) + 500);
                    ctx.resultEl.style.color = "#fbbf24";
                    ctx.resultEl.textContent =
                        "다른 참가자들의 선택을 기다리는 중입니다...";

                    waitTimer = setTimeout(checkResultLoop, waitMs);
                    return;
                }

                if (data.status === "DRAW") {
                    // 최소 득표가 동률이거나 투표가 거의 없는 경우
                    ctx.resultEl.style.color = "#f97373";
                    ctx.resultEl.textContent =
                        "무승부입니다. 다시 선택해 주세요.";
                    voted = false;
                    setButtonsDisabled(false);
                    clearChoiceState();
                    return;
                }

                if (data.status === "LOSE") {
                    ctx.resultEl.style.color = "#f97373";
                    ctx.resultEl.textContent =
                        "당신이 선택한 쪽이 더 많은 선택을 받아, 이 방에 남게 되었습니다. 잠시 후 다시 선택해 보세요.";
                    // 패배해도 같은 스테이지에 그대로 남음 → 다시 버튼 활성화
                    voted = false;
                    setButtonsDisabled(false);
                    clearChoiceState();
                    return;
                }

                if (data.status === "WIN") {
                    ctx.resultEl.style.color = "#4ade80";
                    ctx.resultEl.textContent =
                        "당신의 선택이 소수였습니다! 다음 방으로 이동합니다.";

                    clearChoiceState();

                    const nextStage = data.nextStage || data.currentStage;
                    if (nextStage && window.escapeShowStage) {
                        // 다음 스테이지 문제는 프론트에서 /api/problem으로 다시 로드
                        setTimeout(() => {
                            window.escapeShowStage(nextStage);
                        }, 800);
                    }
                    return;
                }

                // 혹시 모르는 상태값 대비
                ctx.resultEl.style.color = "#f97373";
                ctx.resultEl.textContent = "알 수 없는 상태입니다. 다시 시도해 주세요.";
                voted = false;
                setButtonsDisabled(false);
                clearChoiceState();
            } catch (e) {
                console.error(e);
                ctx.resultEl.style.color = "#f97373";
                ctx.resultEl.textContent =
                    "결과를 확인하는 중 오류가 발생했습니다.";
                voted = false;
                setButtonsDisabled(false);
                clearChoiceState();
            }
        }

        options.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "choice-btn";
            btn.textContent = opt.label || opt.id;

            btn.addEventListener("click", async () => {
                if (voted) return;
                voted = true;
                setButtonsDisabled(true);

                ctx.resultEl.style.color = "#fbbf24";
                ctx.resultEl.textContent =
                    "선택을 기록했습니다. 결과를 기다리는 중입니다...";

                try {
                    const res = await fetch("/api/choiceVote", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            sessionId: window.escapeSessionId,
                            stage: problem.stage,
                            option: opt.id,
                        }),
                    });

                    const data = await res.json();

                    if (!data.ok) {
                        ctx.resultEl.style.color = "#f97373";
                        ctx.resultEl.textContent =
                            data.message || "선택을 기록하는 중 오류가 발생했습니다.";
                        voted = false;
                        setButtonsDisabled(false);
                        clearChoiceState();  // 🔹 서버에서 거절되면 상태 삭제
                        return;
                    }

                    const windowEndMs = Number(data.windowEndMs || 0);
                    const nowMs = Date.now();
                    const waitMs = Math.max(0, windowEndMs - nowMs) + 500;

                    // 🔥 로컬에 현재 선택 상태 저장
                    saveChoiceState({
                        sessionId: window.escapeSessionId,
                        stage: problem.stage,
                        option: opt.id,
                        roundId: data.roundId || null,
                        windowEndMs: windowEndMs || (nowMs + (data.windowMs || 60000)),
                    });

                    waitTimer = setTimeout(checkResultLoop, waitMs);
                } catch (e) {
                    console.error(e);
                    ctx.resultEl.style.color = "#f97373";
                    ctx.resultEl.textContent =
                        "선택을 기록하는 중 오류가 발생했습니다.";
                    voted = false;
                    setButtonsDisabled(false);
                    clearChoiceState();  // 🔹 통신 에러도 상태 삭제
                }
            });

            container.appendChild(btn);
        });

        
        // 설명 텍스트 바로 아래에 선택 버튼 삽입
        if (ctx.descEl && ctx.descEl.parentNode) {
            ctx.descEl.parentNode.insertBefore(container, ctx.resultEl);
        } else {
            document.getElementById("game-screen").appendChild(container);
        }

        // 🔥 [복원 로직] 새로고침해도 선택 유지
        (function restoreChoiceState() {
            const saved = loadChoiceState();
            if (!saved) return;

            // 내 세션 & 같은 스테이지인지 확인
            if (
                saved.sessionId !== window.escapeSessionId ||
                saved.stage !== problem.stage
            ) {
                return;
            }

            const now = Date.now();
            if (!saved.windowEndMs || now >= saved.windowEndMs) {
                // 라운드가 이미 끝났으면 저장된 상태 버림
                clearChoiceState();
                return;
            }

            // 아직 라운드 진행 중이면 → 이미 선택한 상태로 복원
            voted = true;
            setButtonsDisabled(true);

            ctx.resultEl.style.color = "#fbbf24";
            ctx.resultEl.textContent =
                "선택을 기록했습니다. 결과를 기다리는 중입니다...";

            const waitMs = Math.max(0, saved.windowEndMs - now) + 500;
            waitTimer = setTimeout(checkResultLoop, waitMs);
        })();

        // 현재 문제에서 벗어날 때 정리
        ctx._cleanup = function () {
            if (waitTimer) {
                clearTimeout(waitTimer);
                waitTimer = null;
            }
            container.remove();
        };
    }


    /**
     * 외부에서 호출할 진입점
     * - problem.type에 따라 적절한 세팅을 호출
     */
    ProblemTypes.apply = function (problem, ctx) {
        const type = (problem.type || "INPUT").toUpperCase();

        if (type === "TAP") {
            setupTap(problem, ctx);
        } else if (type === "CHOICE") {
            setupChoice(problem, ctx);
        } else {
            setupInput(problem, ctx);
        }
    };

    global.ProblemTypes = ProblemTypes;
})(window);

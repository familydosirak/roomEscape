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

        ctx.resultEl.textContent = "";

        // ✅ HTML에 이미 있는 정답처리 버튼 사용
        const forceCorrectBtn = document.getElementById("force-correct-btn");

        if (forceCorrectBtn) {
            forceCorrectBtn.style.display = "inline-block";
            forceCorrectBtn.classList.remove("hidden");
            forceCorrectBtn.disabled = false;

            forceCorrectBtn.onclick = () => {
                if (!problem.answer) {
                    ctx.resultEl.style.color = "#f97373";
                    ctx.resultEl.textContent = "현재 문제의 정답 정보가 없습니다.";
                    return;
                }

                ctx.answerInput.value = problem.answer;

                if (typeof ctx.submitAnswer === "function") {
                    ctx.submitAnswer(problem.answer);
                }
            };
        }

        ctx._cleanup = function () {
            const btn = document.getElementById("force-correct-btn");
            if (btn) {
                btn.style.display = "none";
                btn.onclick = null;
            }
        };
    }

    function setupUpDown(problem, ctx) {
        cleanupPrev(ctx);

        ctx.inputRow.style.display = "flex";
        ctx.answerInput.disabled = false;
        ctx.submitBtn.disabled = false;

        // ✅ 모바일에서 숫자 키패드 유도
        ctx.answerInput.placeholder = "숫자를 입력하세요";
        ctx.answerInput.setAttribute("inputmode", "numeric");
        ctx.answerInput.setAttribute("pattern", "[0-9]*");

        ctx.resultEl.textContent = "";

        ctx._cleanup = function () {
            // 다음 문제에서 원복(선택)
            ctx.answerInput.removeAttribute("inputmode");
            ctx.answerInput.removeAttribute("pattern");
            ctx.answerInput.placeholder = "정답을 입력하세요";
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
                    ctx.resultEl.style.color = "#4ade80";
                    ctx.resultEl.textContent = "무승부입니다! 다음 방으로 이동합니다.";

                    clearChoiceState();

                    const nextStage = (data.nextStage || data.currentStage || (problem.stage + 1));
                    if (nextStage && window.escapeShowStage) {
                        setTimeout(() => window.escapeShowStage(nextStage), 800);
                    }
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

    function setupPattern(problem, ctx) {
        cleanupPrev(ctx);

        // 입력창은 숨기고(문자 입력 불필요), 제출은 패턴 UI에서 강제로 submitAnswer 호출
        ctx.inputRow.style.display = "none";
        ctx.resultEl.textContent = "";

        const cfg = problem.patternConfig || {};
        const rows = Number(cfg.rows || 4);
        const cols = Number(cfg.cols || 4);
        const total = rows * cols;

        const wrap = document.createElement("div");
        wrap.className = "pattern-wrap";

        const grid = document.createElement("div");
        grid.className = "pattern-grid";
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        // 0/1 상태
        const state = new Array(total).fill(0);

        const cells = [];
        for (let i = 0; i < total; i++) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "pattern-cell";
            cell.setAttribute("aria-label", `cell-${i}`);

            cell.addEventListener("click", () => {
                if (ctx.submitBtn.disabled || ctx.answerInput.disabled) return; // 쿨타임/잠금 존중
                state[i] = state[i] ? 0 : 1;
                cell.classList.toggle("on", state[i] === 1);
            });

            cells.push(cell);
            grid.appendChild(cell);
        }

        const btnRow = document.createElement("div");
        btnRow.className = "pattern-btn-row";

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "pattern-btn";
        clearBtn.textContent = "전체 지우기";

        clearBtn.addEventListener("click", () => {
            if (ctx.submitBtn.disabled || ctx.answerInput.disabled) return;
            for (let i = 0; i < total; i++) {
                state[i] = 0;
                cells[i].classList.remove("on");
            }
        });

        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "pattern-btn primary";
        submitBtn.textContent = "제출";

        submitBtn.addEventListener("click", () => {
            if (ctx.submitBtn.disabled || ctx.answerInput.disabled) return;

            // 16칸(또는 rows*cols칸) 직렬화: "0101..."
            const encoded = state.join("");

            // 강제 제출
            if (typeof ctx.submitAnswer === "function") {
                ctx.submitAnswer(encoded);
            }
        });

        btnRow.appendChild(clearBtn);
        btnRow.appendChild(submitBtn);

        wrap.appendChild(grid);
        wrap.appendChild(btnRow);

        // desc 아래에 붙이기
        if (ctx.descEl && ctx.descEl.parentNode) {
            ctx.descEl.parentNode.insertBefore(wrap, ctx.resultEl);
        } else {
            document.getElementById("game-screen").appendChild(wrap);
        }

        ctx._cleanup = function () {
            wrap.remove();
        };
    }

    function setupMaze(problem, ctx) {
        cleanupPrev(ctx);

        // 텍스트 입력 제출은 사용 안 함
        ctx.inputRow.style.display = "none";
        ctx.resultEl.textContent = "";

        const cfg = problem.mazeConfig || {};
        const L = cfg.leftSymbol || "<";
        const R = cfg.rightSymbol || ">";

        let path = "";

        const wrap = document.createElement("div");
        wrap.className = "maze-wrap";

        const display = document.createElement("div");
        display.className = "maze-display";
        display.textContent = "";

        const btnRow = document.createElement("div");
        btnRow.className = "maze-btn-row";

        const leftBtn = document.createElement("button");
        leftBtn.type = "button";
        leftBtn.className = "maze-btn";
        leftBtn.textContent = "←";

        const rightBtn = document.createElement("button");
        rightBtn.type = "button";
        rightBtn.className = "maze-btn";
        rightBtn.textContent = "→";

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "maze-btn secondary";
        resetBtn.textContent = "초기화";

        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "maze-btn primary";
        submitBtn.textContent = "제출";

        function refresh() {
            if (!path) {
                display.textContent = "";
                return;
            }

            // 화면 표시용 변환 (< > → 화살표)
            const visual = path
                .replaceAll("<", "←")
                .replaceAll(">", "→");

            display.textContent = visual;
        }

        function append(symbol) {
            // 쿨타임/잠금 존중 (너 메인 로직과 동일하게)
            if (ctx.submitBtn.disabled || ctx.answerInput.disabled) return;
            path += symbol;
            refresh();
            ctx.resultEl.style.color = "#9ca3af";
            ctx.resultEl.textContent = "입력 중...";
        }

        function reset() {
            if (ctx.submitBtn.disabled || ctx.answerInput.disabled) return;
            path = "";
            refresh();
            ctx.resultEl.style.color = "#9ca3af";
            ctx.resultEl.textContent = "초기화했습니다.";
        }

        function submit() {
            if (ctx.submitBtn.disabled || ctx.answerInput.disabled) return;

            const answer = (path || "").trim();
            if (!answer) {
                ctx.resultEl.style.color = "#f97373";
                ctx.resultEl.textContent = "좌/우를 입력한 뒤 제출해주세요.";
                return;
            }

            ctx.resultEl.style.color = "#fbbf24";
            ctx.resultEl.textContent = "정답 확인 중...";

            if (typeof ctx.submitAnswer === "function") {
                ctx.submitAnswer(answer);
            }
        }

        leftBtn.addEventListener("click", () => append(L));
        rightBtn.addEventListener("click", () => append(R));
        resetBtn.addEventListener("click", reset);
        submitBtn.addEventListener("click", submit);

        // (옵션) PC 디버깅 편하게 키보드 지원
        const onKey = (e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); append(L); }
            if (e.key === "ArrowRight") { e.preventDefault(); append(R); }
            if (e.key === "Escape") { e.preventDefault(); reset(); }
            if (e.key === "Enter") { e.preventDefault(); submit(); }
        };
        window.addEventListener("keydown", onKey);

        refresh();
        wrap.appendChild(display);
        btnRow.appendChild(leftBtn);
        btnRow.appendChild(rightBtn);
        btnRow.appendChild(resetBtn);
        btnRow.appendChild(submitBtn);
        wrap.appendChild(btnRow);

        // desc 아래에 삽입
        if (ctx.descEl && ctx.descEl.parentNode) {
            ctx.descEl.parentNode.insertBefore(wrap, ctx.resultEl);
        } else {
            ctx.resultEl.parentNode.insertBefore(wrap, ctx.resultEl);
        }

        ctx._cleanup = function () {
            window.removeEventListener("keydown", onKey);
            wrap.remove();
            // 다음 문제에서 기본 입력창 다시 쓰도록 복구
            ctx.inputRow.style.display = "flex";
        };
    }

    function setupFlashlight(problem, ctx) {
        cleanupPrev(ctx);

        if (window.visualViewport) {
            const onVVResize = () => { turnOff(); };
            window.visualViewport.addEventListener("resize", onVVResize);

            const oldCleanup = ctx._cleanup;
            ctx._cleanup = function () {
                window.visualViewport.removeEventListener("resize", onVVResize);
                oldCleanup && oldCleanup();
            };
        }

        ctx.inputRow.style.display = "flex";
        ctx.answerInput.disabled = false;
        ctx.submitBtn.disabled = false;
        ctx.answerInput.placeholder = "정답을 입력하세요";
        ctx.resultEl.textContent = "";

        const gameScreen = document.getElementById("game-screen");
        if (!gameScreen) return;

        const cfg = problem.flashlightConfig || {};
        const radius = Number(cfg.radius || 90);

        // 오버레이 생성
        const overlay = document.createElement("div");
        overlay.className = "flashlight-overlay";
        overlay.style.setProperty("--r", `${radius}px`);
        document.body.appendChild(overlay);

        // =========================
        // ✅ INPUT / SUBMIT 터치는 손전등에서 제외
        // =========================
        const stopFlashlightTouch = (e) => {
            e.stopPropagation();
        };

        // 입력창
        ctx.answerInput.addEventListener("touchstart", stopFlashlightTouch, { passive: true });
        ctx.answerInput.addEventListener("touchend", stopFlashlightTouch, { passive: true });

        // 제출 버튼
        ctx.submitBtn.addEventListener("touchstart", stopFlashlightTouch, { passive: true });
        ctx.submitBtn.addEventListener("touchend", stopFlashlightTouch, { passive: true });


        const OFFSET_X = -50; // 왼쪽으로 40px
        const OFFSET_Y = -65; // 위로 55px

        const setPos = (x, y) => {
            const vv = window.visualViewport;
            const ox = vv ? vv.offsetLeft : 0;
            const oy = vv ? vv.offsetTop : 0;

            // ✅ 손가락 기준 대각선 왼쪽 위로 이동
            const nx = x + OFFSET_X;
            const ny = y + OFFSET_Y;

            overlay.style.setProperty("--x", `${nx + ox}px`);
            overlay.style.setProperty("--y", `${ny + oy}px`);
        };


        let isOn = false;

        // ✅ StarCraft 스타일 엣지 스크롤 (손전등 ON일 때만)
        const EDGE = 90;      // 위/아래 감지 구간(px)
        const MAX_SPEED = 22; // 최대 속도(px/frame)

        let rafId = null;
        let scrollDir = 0; // -1 위, 0 정지, +1 아래
        let lastClientY = 0;

        // ✅ 스크롤 대상: gameScreen 내부 스크롤
        const scrollTarget = gameScreen;

        function computeDir(clientY) {
            const rect = scrollTarget.getBoundingClientRect();
            const y = clientY - rect.top;
            const h = rect.height;

            if (y < EDGE) return -1;
            if (y > h - EDGE) return 1;
            return 0;
        }

        function tick() {
            if (!isOn) {
                rafId = null;
                return;
            }

            // ✅ 손가락이 가만히 있어도 매 프레임 끝 위치인지 다시 계산
            scrollDir = computeDir(lastClientY);

            if (scrollDir !== 0) {
                const rect = scrollTarget.getBoundingClientRect();
                const y = lastClientY - rect.top;
                const h = rect.height;

                let t = 0;
                if (scrollDir < 0) t = Math.max(0, (EDGE - y) / EDGE);
                else t = Math.max(0, (y - (h - EDGE)) / EDGE);

                const speed = Math.max(3, Math.round(MAX_SPEED * t));
                scrollTarget.scrollTop += scrollDir * speed;
            }

            rafId = requestAnimationFrame(tick);
        }

        function updateAutoScroll(clientY) {
            lastClientY = clientY;
            scrollDir = computeDir(clientY);
            if (!rafId) rafId = requestAnimationFrame(tick);
        }

        function stopAutoScroll() {
            scrollDir = 0;
            lastClientY = 0;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        }

        const lockScroll = () => {
            document.body.classList.add("scroll-locked");
        };
        const unlockScroll = () => {
            document.body.classList.remove("scroll-locked");
        };

        const turnOn = (x, y) => {
            isOn = true;
            overlay.classList.add("active");
            lockScroll();
            setPos(x, y);
            updateAutoScroll(y);
        };

        const turnOff = () => {
            isOn = false;
            overlay.classList.remove("active");
            unlockScroll();
            stopAutoScroll();
        };


        // =========================
        // PC: 마우스 이동 시 손전등 이동 + 엣지 스크롤
        // =========================
        const onMove = (e) => {
            if (!isOn) return;
            setPos(e.clientX, e.clientY);
            updateAutoScroll(e.clientY);
        };

        const onMouseDown = (e) => {
            // PC는 클릭으로 ON/OFF 토글(원하면 제거 가능)
            if (!isOn) {
                turnOn(e.clientX, e.clientY);
            } else {
                turnOff();
            }
        };

        // =========================
        // Mobile: "누르는 동안만" 손전등 ON + 드래그 이동 + 엣지 스크롤
        // =========================
        let isPressing = false;

        // ✅ 누르는 순간 ON (스크롤/바운스 방지하려면 passive:false + preventDefault 필요)
        const onTouchStart = (e) => {
            if (!e.touches || !e.touches[0]) return;
            const t = e.touches[0];

            isPressing = true;
            e.preventDefault();            // ✅ 손전등 조작 중 페이지 스크롤 방지

            turnOn(t.clientX, t.clientY);
        };

        const onTouchMove = (e) => {
            if (!isPressing) return;
            if (!e.touches || !e.touches[0]) return;
            const t = e.touches[0];

            e.preventDefault();            // ✅ 드래그 중 스크롤 방지
            setPos(t.clientX, t.clientY);
            updateAutoScroll(t.clientY);
        };

        const onTouchEnd = () => {
            isPressing = false;
            turnOff();                     // ✅ 손 떼면 OFF
        };

        const onTouchCancel = () => {
            isPressing = false;
            turnOff();
        };

        // =========================
        // 이벤트 등록 (여기 추가)
        // =========================
        gameScreen.addEventListener("mousemove", onMove);
        gameScreen.addEventListener("mousedown", onMouseDown);

        gameScreen.addEventListener("touchstart", onTouchStart, { passive: false });
        gameScreen.addEventListener("touchmove", onTouchMove, { passive: false });
        gameScreen.addEventListener("touchend", onTouchEnd, { passive: true });
        gameScreen.addEventListener("touchcancel", onTouchCancel, { passive: true });

        // =========================
        // cleanup (여기 추가)
        // =========================
        ctx._cleanup = function () {
            gameScreen.removeEventListener("mousemove", onMove);
            gameScreen.removeEventListener("mousedown", onMouseDown);

            gameScreen.removeEventListener("touchstart", onTouchStart);
            gameScreen.removeEventListener("touchmove", onTouchMove);
            gameScreen.removeEventListener("touchend", onTouchEnd);
            gameScreen.removeEventListener("touchcancel", onTouchCancel);

            ctx.answerInput.removeEventListener("touchstart", stopFlashlightTouch);
            ctx.answerInput.removeEventListener("touchend", stopFlashlightTouch);
            ctx.submitBtn.removeEventListener("touchstart", stopFlashlightTouch);
            ctx.submitBtn.removeEventListener("touchend", stopFlashlightTouch);

            // 혹시 누른 상태로 나가도 복구
            document.body.classList.remove("scroll-locked");
            stopAutoScroll();
            overlay.remove();
        };

    }

    function setupDuel(problem, ctx) {
        cleanupPrev(ctx);

        ctx.inputRow.style.display = "flex";
        ctx.answerInput.disabled = false;
        ctx.submitBtn.disabled = false;

        ctx.answerInput.placeholder = "8자리 코드를 입력하세요";
        ctx.answerInput.setAttribute("inputmode", "numeric");
        ctx.answerInput.setAttribute("pattern", "[0-9]*");
        ctx.answerInput.setAttribute("maxlength", "8");

        ctx.resultEl.textContent = "";

        const duel = problem.duel || {};
        const isEliminated = !!duel.eliminated;

        // ✅ 패배 버튼 UI
        const loseBtn = document.createElement("button");
        loseBtn.type = "button";
        loseBtn.className = "secondary-btn";
        loseBtn.textContent = "패배";
        loseBtn.className = "duel-lose-btn";

        // input-row 아래에 붙이기
        ctx.inputRow.parentNode.insertBefore(loseBtn, ctx.resultEl);

        // ✅ 이미 탈락 상태면: 입력/제출 막고 코드만 보여주기
        const showEliminated = (code) => {
            ctx.inputRow.style.display = "none";
            ctx.answerInput.disabled = true;
            ctx.submitBtn.disabled = true;
            loseBtn.disabled = true;

            ctx.resultEl.style.color = "#f97373";
            ctx.resultEl.textContent = "탈락했습니다. 더 이상 진행할 수 없습니다.";

            if (code) {
                const codeBox = document.createElement("div");
                codeBox.className = "nickname-message";
                codeBox.style.fontSize = "16px";
                codeBox.style.textAlign = "center";
                codeBox.style.marginTop = "10px";
                codeBox.textContent = `당신의 코드: ${code}`;
                ctx.resultEl.parentNode.insertBefore(codeBox, ctx.finishEl || null);

                // cleanup에서 제거되도록 저장
                ctx._duelCodeBox = codeBox;
            }
        };

        if (isEliminated) {
            showEliminated(duel.code);
        }

        // ✅ 패배 버튼 동작
        loseBtn.addEventListener("click", async () => {
            if (isEliminated) return;

            const ok = confirm("패배를 선택하면 더 이상 진행할 수 없습니다. 정말 패배할까요?");
            if (!ok) return;

            loseBtn.disabled = true;
            ctx.resultEl.style.color = "#fbbf24";
            ctx.resultEl.textContent = "처리 중...";

            try {
                const res = await fetch("/api/duelLose", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId: window.escapeSessionId }),
                });

                const data = await res.json();

                if (!data.ok) {
                    loseBtn.disabled = false;
                    ctx.resultEl.style.color = "#f97373";
                    ctx.resultEl.textContent = data.message || "처리 중 오류가 발생했습니다.";
                    return;
                }

                showEliminated(data.code);
            } catch (e) {
                console.error(e);
                loseBtn.disabled = false;
                ctx.resultEl.style.color = "#f97373";
                ctx.resultEl.textContent = "처리 중 오류가 발생했습니다.";
            }
        });

        ctx._cleanup = function () {
            ctx.answerInput.removeAttribute("inputmode");
            ctx.answerInput.removeAttribute("pattern");
            ctx.answerInput.removeAttribute("maxlength");
            ctx.answerInput.placeholder = "정답을 입력하세요";

            loseBtn.remove();
            if (ctx._duelCodeBox) ctx._duelCodeBox.remove();
        };
    }






    /**
     * 외부에서 호출할 진입점
     * - problem.type에 따라 적절한 세팅을 호출
     */
    ProblemTypes.apply = function (problem, ctx) {
        // ✅ 새 문제 열릴 때마다 game-screen 스크롤을 맨 위로
        const gameScreen = document.getElementById("game-screen");
        if (gameScreen) {
            gameScreen.scrollTop = 0; // 내부 스크롤 초기화
        }
        // (혹시 window 자체가 스크롤되는 레이아웃이면 이것도 같이)
        window.scrollTo(0, 0);

        const type = (problem.type || "INPUT").toUpperCase();

        if (type === "INPUT") {
            setupInput(problem, ctx);
        } else if (type === "TAP") {
            setupTap(problem, ctx);
        } else if (type === "CHOICE") {
            setupChoice(problem, ctx);
        } else if (type === "UPDOWN") {
            setupUpDown(problem, ctx);
        } else if (type === "PATTERN") {
            setupPattern(problem, ctx);
        } else if (type === "MAZE") {
            setupMaze(problem, ctx);
        } else if (type === "FLASHLIGHT") {
            setupFlashlight(problem, ctx);
        } else if (type === "DUEL") {
            setupDuel(problem, ctx);
        } else {
            setupInput(problem, ctx);
        }
    };

    global.ProblemTypes = ProblemTypes;
})(window);

// public/js/admin.js

const refreshBtn = document.getElementById("refresh-btn");
const resetBtn = document.getElementById("reset-btn");
const statusEl = document.getElementById("status");
const tbody = document.getElementById("stats-body");
const clearListEl = document.getElementById("clear-list");

const lockOverlay = document.getElementById("admin-lock");
const adminContent = document.getElementById("admin-content");
const adminPwdInput = document.getElementById("admin-password-input");
const adminLoginBtn = document.getElementById("admin-login-btn");
const adminLockMsg = document.getElementById("admin-lock-msg");

// 🔐 현재 로그인된 관리자 비밀번호(성공 후에만 세팅)
let adminPassword = "";

// 🔥 자동 새로고침 관련 전역 상태
const AUTO_REFRESH_MS = 15000;
let autoTimer = null;
let isLoading = false;

/**
 * 통계 데이터를 화면에 렌더링
 */
function renderStats(stages) {
    tbody.innerHTML = "";

    (stages || []).forEach((s) => {
        const tr = document.createElement("tr");

        const tdStage = document.createElement("td");
        tdStage.textContent = `${s.stage}번`;
        tr.appendChild(tdStage);

        /* const tdTitle = document.createElement("td");
        tdTitle.textContent = s.title || "";
        tr.appendChild(tdTitle); */

        const tdCleared = document.createElement("td");
        tdCleared.textContent = `${s.clearedCount || 0}명`;
        tr.appendChild(tdCleared);

        const tdNames = document.createElement("td");
        const names = s.challengers || [];

        if (names.length) {
            const tagWrap = document.createElement("div");
            tagWrap.className = "tag-list";

            const MAX_SHOW = 10;
            const visible = names.slice(0, MAX_SHOW);
            const rest = names.slice(MAX_SHOW);

            visible.forEach((name) => {
                const tag = document.createElement("span");
                tag.className = "tag";
                tag.textContent = name;
                tagWrap.appendChild(tag);
            });

            if (rest.length > 0) {
                const moreTag = document.createElement("span");
                moreTag.className = "tag tag-more";
                moreTag.textContent = `그 외 ${rest.length}명`;
                moreTag.setAttribute("data-tooltip", rest.join(", "));
                tagWrap.appendChild(moreTag);
            }

            tdNames.appendChild(tagWrap);
        } else {
            // ✅ 도전 인원 없을 때 깔끔한 문구 + 왼쪽 정렬
            const empty = document.createElement("span");
            empty.className = "empty-text";
            empty.textContent = "- 도전중인 인원 없음";
            tdNames.appendChild(empty);
        }

        tr.appendChild(tdNames);

        tbody.appendChild(tr);
    });

    // 테이블 렌더 후, 클리어 섹션도 같이 업데이트
    renderClearList(stages || []);
}

function renderClearList(stages) {
    if (!clearListEl) return;

    clearListEl.innerHTML = "";

    if (!stages || !stages.length) {
        const empty = document.createElement("div");
        empty.className = "clear-stage-title";
        empty.textContent = "아직 클리어한 사람이 없습니다.";
        clearListEl.appendChild(empty);
        return;
    }

    let hasAny = false;

    // 🔥 가장 마지막 스테이지 번호 찾기 (최종 클리어 기준)
    const maxStage = stages.reduce((max, s) => {
        const n = Number(s.stage || 0);
        return n > max ? n : max;
    }, 0);

    stages.forEach((s) => {
        const clearers = s.clearers || [];
        if (!clearers.length) return;

        hasAny = true;

        const isFinalStage = Number(s.stage) === maxStage;

        const block = document.createElement("div");
        block.className = "clear-stage-block" + (isFinalStage ? " clear-stage-final" : "");

        const titleEl = document.createElement("div");
        titleEl.className = "clear-stage-title";
        titleEl.textContent = `${s.stage}번 방` +
            (isFinalStage ? " (최종 클리어)" : "");

        const listWrap = document.createElement("div");
        listWrap.className = "tag-list clear-tag-list";

        const MAX_SHOW = 10;

        // ✅ 최종 스테이지는 전체 표시, 나머지는 10명까지만 표시
        const visible = isFinalStage ? clearers : clearers.slice(0, MAX_SHOW);
        const rest = isFinalStage ? [] : clearers.slice(MAX_SHOW);

        // 보이는 애들 태그 생성
        visible.forEach((name, idx) => {
            const tag = document.createElement("span");
            tag.className = "tag clear-tag";
            tag.textContent = `${idx + 1}위 ${name}`;
            listWrap.appendChild(tag);
        });

        // 나머지는 "그 외 N명" + 툴팁으로 전체 이름 보여주기
        if (rest.length > 0) {
            const moreTag = document.createElement("span");
            moreTag.className = "tag clear-tag tag-more";

            moreTag.textContent = `그 외 ${rest.length}명`;

            // 나머지 사람들도 몇 위인지 포함해서 툴팁으로
            const startRank = visible.length + 1;
            const tooltipText = rest
                .map((name, i) => `${startRank + i}위 ${name}`)
                .join(", ");

            moreTag.setAttribute("data-tooltip", tooltipText);
            listWrap.appendChild(moreTag);
        }

        block.appendChild(titleEl);
        block.appendChild(listWrap);
        clearListEl.appendChild(block);
    });

    if (!hasAny) {
        const empty = document.createElement("div");
        empty.className = "clear-stage-title";
        empty.textContent = "아직 클리어한 사람이 없습니다.";
        clearListEl.appendChild(empty);
    }
}


/**
 * 자동 새로고침 시작
 */
function startAutoRefresh() {
    if (autoTimer) {
        clearInterval(autoTimer);
    }
    autoTimer = setInterval(loadStats, AUTO_REFRESH_MS);
}

/**
 * 자동 새로고침 종료
 */
function stopAutoRefresh() {
    if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
    }
}

/**
 * 관리자 잠금 해제 (UI만)
 */
function showAdminContent() {
    if (lockOverlay) lockOverlay.classList.add("hidden");
    if (adminContent) adminContent.classList.remove("hidden");
}

/**
 * 다시 잠그기 (401 등)
 */
function showLockScreen() {
    stopAutoRefresh();
    adminPassword = "";

    if (adminContent) adminContent.classList.add("hidden");
    if (lockOverlay) lockOverlay.classList.remove("hidden");

    if (adminPwdInput) {
        adminPwdInput.value = "";
        adminPwdInput.focus();
    }
}

/**
 * 통계 로딩 (이미 로그인된 상태에서만 사용)
 */
async function loadStats() {
    if (isLoading) return;
    isLoading = true;

    statusEl.textContent = "통계 불러오는 중...";

    try {
        if (!adminPassword) {
            statusEl.textContent = "관리자 비밀번호가 설정되지 않았습니다.";
            isLoading = false;
            showLockScreen();
            return;
        }

        const res = await fetch("/api/admin/stats", {
            headers: {
                "X-Admin-Password": adminPassword,
            },
        });

        if (res.status === 401) {
            statusEl.textContent =
                "관리자 비밀번호가 올바르지 않습니다. 다시 로그인해주세요.";
            isLoading = false;
            showLockScreen();
            return;
        }

        const data = await res.json();

        if (!data.ok) {
            statusEl.textContent = data.message || "통계 조회 실패";
            isLoading = false;
            return;
        }

        renderStats(data.stages || []);

        const now = new Date();
        statusEl.textContent = `마지막 갱신: ${now.toLocaleTimeString()} (자동 새로고침 ${AUTO_REFRESH_MS / 1000}초 간격)`;
    } catch (e) {
        console.error(e);
        statusEl.textContent = "통계 조회 중 오류가 발생했습니다.";
    } finally {
        isLoading = false;
    }
}

/**
 * 관리자 통계 / 랭킹 초기화
 */
async function resetStats() {
    if (
        !confirm(
            "정말 통계 / 도착 순위 / 진행도를 모두 초기화할까요?\n(모든 참가자가 1번부터 다시 시작하게 됩니다.)",
        )
    ) {
        return;
    }

    if (!adminPassword) {
        alert("관리자 비밀번호가 설정되지 않았습니다. 다시 로그인해주세요.");
        showLockScreen();
        return;
    }

    statusEl.textContent = "초기화 중...";

    try {
        const res = await fetch("/api/admin/resetStats", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Password": adminPassword,
            },
        });

        if (res.status === 401) {
            statusEl.textContent =
                "관리자 비밀번호가 올바르지 않습니다. 다시 로그인해주세요.";
            showLockScreen();
            return;
        }

        const data = await res.json();

        if (!data.ok) {
            statusEl.textContent = data.message || "초기화 실패";
            return;
        }

        alert(data.message || "초기화되었습니다.");
        await loadStats(); // 초기화 직후 한 번 강제 갱신
    } catch (e) {
        console.error(e);
        statusEl.textContent = "초기화 중 오류가 발생했습니다.";
    }
}

/**
 * 로그인 버튼 클릭 시: 비번 검증 + 성공하면 관리자 화면 열기
 */
async function handleAdminLogin() {
    const input = adminPwdInput ? adminPwdInput.value.trim() : "";

    if (!input) {
        if (adminLockMsg) {
            adminLockMsg.style.color = "#f97373";
            adminLockMsg.textContent = "비밀번호를 입력해주세요.";
        }
        return;
    }

    // 일단 입력값으로 테스트 호출
    if (adminLockMsg) {
        adminLockMsg.style.color = "#9ca3af";
        adminLockMsg.textContent = "비밀번호 확인 중...";
    }

    try {
        const res = await fetch("/api/admin/stats", {
            headers: {
                "X-Admin-Password": input,
            },
        });

        if (res.status === 401) {
            if (adminLockMsg) {
                adminLockMsg.style.color = "#f97373";
                adminLockMsg.textContent = "비밀번호가 올바르지 않습니다.";
            }
            if (adminPwdInput) {
                adminPwdInput.select();
            }
            return;
        }

        const data = await res.json();

        if (!data.ok) {
            if (adminLockMsg) {
                adminLockMsg.style.color = "#f97373";
                adminLockMsg.textContent =
                    data.message || "통계를 불러오는 중 오류가 발생했습니다.";
            }
            return;
        }

        // ✅ 여기까지 왔으면 비밀번호 정상
        adminPassword = input;

        if (adminLockMsg) {
            adminLockMsg.style.color = "#4ade80";
            adminLockMsg.textContent = "로그인 성공! 관리자 페이지로 이동합니다.";
        }

        // UI 열기
        showAdminContent();
        renderStats(data.stages || []);

        const now = new Date();
        statusEl.textContent = `마지막 갱신: ${now.toLocaleTimeString()} (자동 새로고침 ${AUTO_REFRESH_MS / 1000}초 간격)`;

        // 자동 새로고침 시작
        startAutoRefresh();
    } catch (e) {
        console.error(e);
        if (adminLockMsg) {
            adminLockMsg.style.color = "#f97373";
            adminLockMsg.textContent =
                "비밀번호 확인 중 오류가 발생했습니다.";
        }
    }
}

// 이벤트 바인딩
refreshBtn.addEventListener("click", loadStats);
resetBtn.addEventListener("click", resetStats);

if (adminLoginBtn) {
    adminLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleAdminLogin();
    });
}

if (adminPwdInput) {
    adminPwdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAdminLogin();
        }
    });

    adminPwdInput.focus();
}

// ================= 전역 툴팁(.tag-more용) =================

let tooltipEl = null;

/**
 * 툴팁 DOM을 한번만 생성
 */
function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip-bubble";
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

/**
 * target(.tag-more)을 기준으로 툴팁 표시
 */
function showTooltipFor(target) {
    const text = target.getAttribute("data-tooltip");
    if (!text) return;

    const el = ensureTooltipEl();
    el.textContent = text;

    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top; // 태그 위쪽 기준

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    el.classList.add("visible");
}

/**
 * 툴팁 숨기기
 */
function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove("visible");
}

/**
 * 마우스 이동 시 .tag-more 위면 툴팁 보여주고,
 * 아니면 숨기기 (이벤트 위임)
 */
document.addEventListener("mousemove", (e) => {
    const target = e.target.closest(".tag-more");

    if (target) {
        showTooltipFor(target);
    } else {
        hideTooltip();
    }
});

// 스크롤/리사이즈 시에도 잠깐 숨기기
window.addEventListener("scroll", hideTooltip);
window.addEventListener("resize", hideTooltip);


// ❌ 페이지 진입 시 자동 조회 / 자동 새로고침 금지
//    반드시 비밀번호가 맞아야만 loadStats/startAutoRefresh가 실행됨

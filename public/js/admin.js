/* =========================================================
admin.js — 방탈출 관리자 페이지 (경마 애니메이션 완성본)
========================================================= */

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

const raceTrackEl = document.getElementById("race-track");
const raceTitleEl = document.getElementById("race-title");

/* =========================================================
🐎 전역 저장소 — “이전 위치” 기억 → 추월 애니메이션에 사용
예: prevRacePositions["홍길동"] = 0.85
   ========================================================= */
let prevRacePositions = {};

let raceHorseMap = {}; // 기존 말 DOM 재사용

let adminPassword = "";
const AUTO_REFRESH_MS = 15000;
let autoTimer = null;
let isLoading = false;

/* =========================================================
0. 공용 툴팁
========================================================= */

let tooltipEl = null;

function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip-bubble";
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

function showTooltipFor(target) {
    const text = target.getAttribute("data-tooltip");
    if (!text) return;
    const el = ensureTooltipEl();
    el.textContent = text;

    const rect = target.getBoundingClientRect();
    el.style.left = rect.left + rect.width / 2 + "px";
    el.style.top = rect.top + "px";

    el.classList.add("visible");
}

function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove("visible");
}

document.addEventListener("mousemove", (e) => {
    const target = e.target.closest(".tag-more");
    if (target) showTooltipFor(target);
    else hideTooltip();
});

window.addEventListener("scroll", hideTooltip);
window.addEventListener("resize", hideTooltip);

/* =========================================================
   1. 테이블 렌더링
   ========================================================= */

function renderStats(stages) {
    tbody.innerHTML = "";

    (stages || []).forEach((s) => {
        const tr = document.createElement("tr");

        const tdStage = document.createElement("td");
        tdStage.textContent = `${s.stage}번`;
        tr.appendChild(tdStage);

        const tdCleared = document.createElement("td");
        tdCleared.textContent = `${s.clearedCount || 0}명`;
        tr.appendChild(tdCleared);

        const tdNames = document.createElement("td");
        const names = s.challengers || [];

        if (names.length > 0) {
            const wrap = document.createElement("div");
            wrap.className = "tag-list";

            const MAX = 10;
            const shown = names.slice(0, MAX);
            const rest = names.slice(MAX);

            shown.forEach((n) => {
                const tag = document.createElement("span");
                tag.className = "tag";
                tag.textContent = n;
                wrap.appendChild(tag);
            });

            if (rest.length > 0) {
                const tag = document.createElement("span");
                tag.className = "tag tag-more";
                tag.textContent = `그 외 ${rest.length}명`;
                tag.setAttribute("data-tooltip", rest.join(", "));
                wrap.appendChild(tag);
            }
            tdNames.appendChild(wrap);
        } else {
            const no = document.createElement("span");
            no.className = "empty-text";
            no.textContent = "- 도전중인 인원 없음";
            tdNames.appendChild(no);
        }

        tr.appendChild(tdNames);
        tbody.appendChild(tr);
    });

    renderClearList(stages);
    renderRaceGlobal(stages);
}

/* =========================================================
   2. 클리어 리스트
   ========================================================= */

function renderClearList(stages) {
    clearListEl.innerHTML = "";

    let hasAny = false;

    const maxStage = Math.max(
        ...stages.map((s) => Number(s.stage || 0)),
        0,
    );

    stages.forEach((s) => {
        const list = s.clearers || [];
        if (!list.length) return;

        hasAny = true;

        const isFinal = Number(s.stage) === maxStage;

        const block = document.createElement("div");
        block.className = "clear-stage-block" + (isFinal ? " clear-stage-final" : "");

        const title = document.createElement("div");
        title.className = "clear-stage-title";
        title.textContent = `${s.stage}번 방${isFinal ? " (최종 클리어)" : ""}`;

        const wrap = document.createElement("div");
        wrap.className = "tag-list clear-tag-list";

        const MAX = 10;
        const shown = isFinal ? list : list.slice(0, MAX);
        const rest = isFinal ? [] : list.slice(MAX);

        shown.forEach((name, idx) => {
            const tag = document.createElement("span");
            tag.className = "tag clear-tag";
            tag.textContent = `${idx + 1}위 ${name}`;
            wrap.appendChild(tag);
        });

        if (rest.length > 0) {
            const more = document.createElement("span");
            more.className = "tag clear-tag tag-more";
            more.textContent = `그 외 ${rest.length}명`;

            const start = shown.length + 1;
            more.setAttribute(
                "data-tooltip",
                rest.map((n, i) => `${start + i}위 ${n}`).join(", "),
            );

            wrap.appendChild(more);
        }

        block.appendChild(title);
        block.appendChild(wrap);

        clearListEl.appendChild(block);
    });

    if (!hasAny) {
        const empty = document.createElement("div");
        empty.className = "clear-stage-title";
        empty.textContent = "아직 클리어한 사람이 없습니다.";
        clearListEl.appendChild(empty);
    }
}

/* =========================================================
   3. 전체 도전중 인원 → 글로벌 순위 생성
   ========================================================= */

function buildGlobalRunners(stages) {
    if (!stages) return [];

    const sorted = [...stages].sort((a, b) => Number(b.stage) - Number(a.stage));

    const result = [];

    sorted.forEach((s) => {
        const names = s.challengers || [];
        names.forEach((name, idx) => {
            result.push({
                name,
                stage: Number(s.stage),
                stageRank: idx + 1,
            });
        });
    });

    return result;
}

/* =========================================================
   4. 🐎 경마 렌더링 (추월 애니메이션 완성본)
   ========================================================= */

function renderRaceGlobal(stages) {
    if (!raceTrackEl) return;

    const all = buildGlobalRunners(stages);
    const top = all.slice(0, 20);
    const n = top.length;

    raceTrackEl.innerHTML = "";

    if (n === 0) {
        raceTrackEl.classList.add("race-track-empty");
        raceTrackEl.innerHTML = `<p class="race-empty">도전중인 참가자가 없습니다.</p>`;
        raceTitleEl.textContent = "전체 도전중 인원 랭킹";
        return;
    }

    raceTrackEl.classList.remove("race-track-empty");
    raceTitleEl.textContent = `전체 도전중 인원 랭킹 (상위 ${n}명)`;

    const newPositions = {};

    top.forEach((runner, index) => {
        const globalRank = index + 1;

        let progress;
        if (n === 1) progress = 0.9;
        else {
            const t = (n - globalRank) / (n - 1);
            progress = 0.25 + t * (0.9 - 0.25);
        }

        newPositions[runner.name] = progress;

        let horseInfo = raceHorseMap[runner.name];

        if (!horseInfo) {
            const lane = document.createElement("div");
            lane.className = "race-lane";

            const rankEl = document.createElement("span");
            rankEl.className = "race-rank";

            const track = document.createElement("div");
            track.className = "race-lane-track";

            const horseEl = document.createElement("div");
            horseEl.className = "race-horse";

            horseEl.innerHTML = `
                <span class="race-icon">🏇</span>
                <span class="race-name"></span>
                <span class="race-stage-label"></span>
            `;

            track.appendChild(horseEl);
            lane.appendChild(rankEl);
            lane.appendChild(track);

            raceHorseMap[runner.name] = {
                laneEl: lane,
                horseEl,
                rankEl,
            };

            horseInfo = raceHorseMap[runner.name];
        }

        const { laneEl, horseEl, rankEl } = horseInfo;

        rankEl.textContent = `${globalRank}위`;

        horseEl.querySelector(".race-name").textContent = runner.name;
        horseEl.querySelector(".race-stage-label").textContent =
            `(${runner.stage}번 방 ${runner.stageRank}위)`;

        const oldPos = prevRacePositions[runner.name];

        if (oldPos === undefined) {
            horseEl.style.transition = "none";
            horseEl.style.left = `${progress * 100}%`;

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    horseEl.style.transition = "left 0.8s ease-out";
                    horseEl.style.left = `${progress * 100}%`;
                });
            });
        } else {
            horseEl.style.transition = "none";
            horseEl.style.left = `${oldPos * 100}%`;

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    horseEl.style.transition = "left 0.8s ease-out";
                    horseEl.style.left = `${progress * 100}%`;
                });
            });
        }

        raceTrackEl.appendChild(laneEl);
    });

    prevRacePositions = newPositions;
}

/* =========================================================
   5. 통계 로딩 / 로그인 / 초기화
   ========================================================= */

async function loadStats() {
    if (isLoading) return;
    isLoading = true;

    statusEl.textContent = "통계 불러오는 중...";

    try {
        if (!adminPassword) {
            showLockScreen();
            return;
        }

        const res = await fetch("/api/admin/stats", {
            headers: {
                "X-Admin-Password": adminPassword,
            },
        });

        if (res.status === 401) {
            showLockScreen();
            return;
        }

        const data = await res.json();

        if (!data.ok) {
            statusEl.textContent = data.message || "통계 조회 실패";
            return;
        }

        renderStats(data.stages || []);

        statusEl.textContent =
            `마지막 갱신: ${new Date().toLocaleTimeString()} (자동 새로고침 ${AUTO_REFRESH_MS / 1000}s)`;
    } catch (e) {
        console.error(e);
        statusEl.textContent = "통계 조회 중 오류 발생";
    } finally {
        isLoading = false;
    }
}

async function resetStats() {
    if (!confirm("정말 초기화할까요? 모든 사람이 1번부터 다시 시작합니다.")) return;

    const res = await fetch("/api/admin/resetStats", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Admin-Password": adminPassword,
        },
    });

    if (res.status === 401) {
        showLockScreen();
        return;
    }

    const data = await res.json();

    alert(data.message || "초기화되었습니다.");
    loadStats();
}

function showAdminContent() {
    lockOverlay.classList.add("hidden");
    adminContent.classList.remove("hidden");
}

function showLockScreen() {
    stopAutoRefresh();
    adminPassword = "";

    adminContent.classList.add("hidden");
    lockOverlay.classList.remove("hidden");

    adminPwdInput.value = "";
    adminPwdInput.focus();
}

async function handleAdminLogin() {
    const input = adminPwdInput.value.trim();
    if (!input) return;

    adminLockMsg.textContent = "비밀번호 확인 중...";
    adminLockMsg.style.color = "#9ca3af";

    try {
        const res = await fetch("/api/admin/stats", {
            headers: { "X-Admin-Password": input },
        });

        if (res.status === 401) {
            adminLockMsg.textContent = "비밀번호가 올바르지 않습니다.";
            adminLockMsg.style.color = "#f97373";
            return;
        }

        const data = await res.json();
        if (!data.ok) {
            adminLockMsg.textContent = "통계를 불러오는 중 오류 발생";
            adminLockMsg.style.color = "#f97373";
            return;
        }

        adminPassword = input;

        adminLockMsg.textContent = "로그인 성공!";
        adminLockMsg.style.color = "#4ade80";

        showAdminContent();
        renderStats(data.stages || []);
        startAutoRefresh();
    } catch (e) {
        adminLockMsg.textContent = "로그인 오류";
        adminLockMsg.style.color = "#f97373";
    }
}

/* =========================================================
   6. 자동 새로고침
   ========================================================= */

function startAutoRefresh() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(loadStats, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
}

/* =========================================================
   7. 이벤트
   ========================================================= */

refreshBtn.addEventListener("click", loadStats);
resetBtn.addEventListener("click", resetStats);

adminLoginBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleAdminLogin();
});

adminPwdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        handleAdminLogin();
    }
});

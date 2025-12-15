// functions/problems.js

// 방탈출 문제들 정의 (정답은 여기만 존재)
const problems = [
    {
        stage: 1,
        type: "INPUT", // 기본: 텍스트 정답 입력
        title: "", //제목
        imageUrl: "/img/q1.png",
        description: "", //내용
        answer: "UNDERTABLE",
    },
    {
        stage: 2,
        type: "CHOICE", // 🔥 A/B 선택형 문제
        title: "",
        imageUrl: "/img/q2.png",
        description: "",
        // 사용자가 클릭했을 때 서버로 보내질 값들
        options: [
            { id: "A", label: "A 방" },
            { id: "B", label: "B 방" },
        ],

        /**
         * 단순 정답형이면 여기 answer에 "A"나 "B"를 넣고
         * minority / 다수결 분기 같은 특수 룰을 하고 싶으면
         * 서버 로직에서 type/choiceConfig를 보고 처리하면 됨.
         */
        answer: "A",

        // 🔥 예시: 1분마다 집계해서 더 적은 쪽만 다음 스테이지로 넘기는 등의
        //          규칙을 서버에서 구현할 때 사용할 수 있는 설정 구조
        choiceConfig: {
            mode: "MINORITY_GO_NEXT", // (예시) 소수 선택만 다음 문제로
            groupId: "branch1",       // 같은 그룹으로 집계할 키
            windowMs: 60000,          // 집계 시간 60초
        },
    },
    {
        stage: 3,
        type: "UPDOWN",
        title: "",
        imageUrl: "/img/q3.png",
        description: "",
        answer: "517",
        updownConfig: {
            min: 1,
            max: 999,
        },
    },
    {
        stage: 4,
        type: "PATTERN",
        title: "",
        imageUrl: "/img/q4.png",
        description: "",
        // 예시 정답(16칸): 1/0 문자열로 저장
        // 0 1 2 3
        // 4 5 6 7
        // 8 9 10 11
        // 12 13 14 15
        answer: "1011010110101101",
        patternConfig: {
            rows: 4,
            cols: 4,
        },
    },
    {
        stage: 5,
        type: "INPUT",
        title: "",
        imageUrl: "/img/q5.png",
        description: "",
        answer: "76",
    },
    {
        stage: 6,
        type: "INPUT",
        title: "",
        imageUrl: "/img/q6.png",
        description: "",
        answer: "light",
    },
    {
        stage: 7,
        type: "TAP", // 🔥 화면을 여러 번 터치해야 통과
        title: "",
        imageUrl: "/img/q7.png",
        description: "",
        // TAP형도 결국 서버에는 문자열로 정답을 저장해둠 (유저는 이 값은 몰라)
        answer: "TAP_10",
        tapConfig: {
            requiredTaps: 10,     // 필요한 터치 횟수
            resetAfterMs: 5000, // (옵션) 10초 지나면 카운트 초기화
        },
    },
    {
        stage: 8,
        type: "INPUT",
        title: "",
        imageUrl: "/img/q8.png",
        description: "",
        answer: "arboris",
    },
    {
        stage: 9,
        type: "MAZE",
        title: "",
        imageUrl: "/img/q9.png",
        description: "",
        answer: "<><>><><><><><><<><>><>><<<><>",
        mazeConfig: {
            leftSymbol: "<",
            rightSymbol: ">",
            lockOnWrong: true,     // 틀리면 막혀서 초기화만 가능
            showProgress: true,    // 진행 표시
        },
    },
    {
        stage: 10,
        type: "FLASHLIGHT",   // ✅ 변경
        title: "",
        imageUrl: "/img/q10.png",
        description: "",
        answer: "75",
        flashlightConfig: {
            radius: 105,         // 손전등 반경(px) - 취향대로 70~140
        },
    },
    {
        stage: 11,
        type: "INPUT",
        title: "",
        imageUrl: "/img/q11.png",
        description: "",
        answer: "light",
    },
    {
        stage: 12,
        type: "INPUT",
        title: "",
        imageUrl: "/img/q12.png",
        description: "",
        answer: "WIN",
    },

];

module.exports = problems;

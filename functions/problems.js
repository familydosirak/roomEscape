// functions/problems.js

// 방탈출 문제들 정의 (정답은 여기만 존재)
const problems = [
    {
        stage: 1,
        type: "INPUT", // 기본: 텍스트 정답 입력
        title: "1번 방",
        imageUrl: "/img/q1.png",
        description: "첫 번째 방입니다. 이미지 속 단서를 보고 정답을 적어보세요.",
        answer: "APPLE",
    },
    {
        stage: 2,
        type: "TAP", // 🔥 화면을 여러 번 터치해야 통과
        title: "2번 방 - 화면 두드리기",
        imageUrl: "/img/q2.png",
        description: "화면을 10번 두드리면 다음 방으로 넘어갑니다.",
        // TAP형도 결국 서버에는 문자열로 정답을 저장해둠 (유저는 이 값은 몰라)
        answer: "TAP_10", 
        tapConfig: {
            requiredTaps: 10,     // 필요한 터치 횟수
            resetAfterMs: 5000, // (옵션) 10초 지나면 카운트 초기화
        },
    },
    {
        stage: 3,
        type: "CHOICE", // 🔥 A/B 선택형 문제
        title: "3번 방 - A / B 선택",
        imageUrl: "/img/q3.png",
        description: "둘 중 하나를 선택하세요. 어떤 선택이 기다리고 있을까요?",
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
        stage: 4,
        type: "INPUT",
        title: "4번 방",
        imageUrl: "/img/q4.png",
        description: "네 번째 문제입니다.",
        answer: "PEACH",
    },
    {
        stage: 5,
        type: "INPUT",
        title: "5번 방",
        imageUrl: "/img/q5.png",
        description: "다섯 번째 문제입니다.",
        answer: "TOMATO",
    },
];

module.exports = problems;

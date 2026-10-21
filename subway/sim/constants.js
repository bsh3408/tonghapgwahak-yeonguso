// 게임 규칙 계산에 쓰는 고정 값. 화면 640×360 픽셀 기준.
export const TICK_HZ = 30;
export const DT = 1 / 30;
export const SPEED_SCALE = 1.5;          // 설계서 속도(플레이어 82 등)에 곱하는 값
export const VIEW_W = 640, VIEW_H = 360;
export const Y0 = 118, Y1 = 296;         // 칸 바닥의 위·아래 끝
export const CAR_W = 1024;               // 칸 하나의 가로 길이(화면 약 1.6개)
export const INPUT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, ATTACK: 16, SKILL: 32, SWAP: 64, ITEM: 128 };

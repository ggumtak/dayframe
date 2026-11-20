# Dayframe

할 일, 습관, 집중을 하루 한 장에 담는 모바일 앱입니다. Todoist처럼 빠르게 적고, TickTick처럼 하루를 실행합니다.

| 기능 | 내용 |
| --- | --- |
| 빠른 추가 | 어느 탭에서나 + 버튼. `내일 저녁 7시 운동 매주 월수금 #건강 @외출 p2`처럼 적으면 날짜·반복·프로젝트·태그·우선순위를 입력하는 동안 표시합니다. 한국어와 영어를 모두 이해합니다. |
| 오늘 · 받은함 · 예정 | 밀어서 완료·일정 변경·삭제, 길게 눌러 순서 변경, 하위 작업, 지연된 일을 한 번에 오늘로 옮기기 |
| 습관 | 체크인 카드, 연속 기록, 17주 히트맵과 달력 |
| 타임라인 | 오늘 일정을 시간대별 블록으로 보기 |
| 집중 타이머 | 할 일이나 습관에 연결하는 포모도로 타이머 |
| 앱 업데이트 | 설정의 "지금 업데이트"로 새 APK를 앱 안에서 내려받아 설치 |
| 오프라인 | 연결이 끊겨도 기록하고, 연결되면 순서대로 서버에 반영 |

## 설치 (Android)

1. [Releases](../../releases/latest)에서 `dayframe.apk`를 내려받습니다.
2. 파일을 열고, 처음 한 번 "이 출처 허용"을 켭니다.
3. 이후 새 버전은 앱의 **설정 → 앱 업데이트 → 지금 업데이트**로 받습니다. 브라우저를 열 필요가 없습니다.

iOS는 같은 코드로 빌드할 수 있으며, TestFlight 링크가 등록되면 앱이 그 링크로 안내합니다.

## 저장소 구성

| 경로 | 역할 |
| --- | --- |
| [apps/mobile](apps/mobile) | Expo(React Native) 앱. 개발·빌드 방법은 [apps/mobile/README.md](apps/mobile/README.md) |
| [supabase](supabase) | PostgreSQL 스키마와 Edge Function REST API. 실행·배포 방법은 [BACKEND_README.md](BACKEND_README.md) |
| [packages/shared/types.ts](packages/shared/types.ts) | 앱과 서버가 함께 쓰는 타입 |
| [API_CONTRACT.md](API_CONTRACT.md) · [openapi.yaml](openapi.yaml) | API 계약 |
| [.github/workflows](.github/workflows) | 검사(CI)와 APK 빌드·릴리스 |

## 새 버전 배포

`v1.2.3` 형식의 태그를 올리면 [Build Android APK](.github/workflows/build-android-apk.yml) 워크플로가 APK를 빌드·서명해 GitHub Release에 올립니다. 설치된 앱은 이 Release를 보고 업데이트를 안내합니다.

```sh
git tag v1.2.3 && git push origin v1.2.3
```

배포 전에 한 번만 준비할 것:

- **서버 주소**: `apps/mobile/.env`에 Supabase URL과 공개(publishable) 키를 적습니다. 없으면 태그 빌드가 중단됩니다.
- **서명 키**: 저장소 Secrets에 `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`를 등록합니다. 없으면 공개된 디버그 키로 서명되며 경고가 표시됩니다. 한 키로 설치한 앱은 다른 키로 서명한 APK로 업데이트할 수 없으므로, 친구들에게 배포하기 전에 정해야 합니다.

## 검사

```sh
npm ci && npm run check && npm test                                     # 백엔드
cd apps/mobile && npm ci && npm run typecheck && npm run lint && npm test # 앱
```

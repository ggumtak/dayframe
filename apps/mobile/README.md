# Dayframe 모바일 앱

Expo SDK 58 · React Native · TypeScript. Android APK로 배포합니다. 웹 빌드는 개발·검증용입니다.

## 개발

Node.js 24 이상이 필요합니다.

```sh
npm ci
cp .env.example .env.local   # Supabase URL과 공개 키를 채웁니다
npm run web                  # 브라우저에서 실행
npm run android              # Expo Go 또는 개발 빌드로 실행
```

`.env.local`의 두 값은 앱에 그대로 담기는 공개 값입니다. 서비스 역할(service role) 키는 절대 넣지 않습니다. 배포용 빌드는 같은 두 값을 `release.config.json`에서 읽습니다.

```sh
npm run typecheck   # 타입 검사
npm run lint        # 린트
npm test            # 업데이트 버전 비교 로직 단위 테스트
```

## 구조

| 경로 | 내용 |
| --- | --- |
| `src/app` | 화면(expo-router). `(tabs)`에 오늘·받은함·예정·습관·집중, 그 밖에 할 일 상세·습관 상세·설정·로그인 |
| `src/features/quick-add` | 떠 있는 + 버튼과 입력 바, 입력 중 토큰 강조 |
| `src/features/tasks` | 목록, 일정 변경 시트, 타임라인 |
| `src/features/habits` | 체크인 카드, 히트맵 |
| `src/features/update` | 인앱 업데이트: 릴리스 확인, 다운로드, 설치 |
| `src/data` | TanStack Query 캐시와 오프라인 쓰기 큐 |
| `src/lib` | API 클라이언트, 인증, 날짜 계산 |
| `modules/apk-installer` | Android 전용 네이티브 모듈: 설치 권한 확인, APK 서명·버전 검사, 설치 화면 열기 |

빠른 입력 해석기는 서버와 같은 코드(`supabase/functions/api/parser.ts`)를 그대로 가져다 씁니다. 그래서 오프라인에서도 서버와 똑같이 해석하고, 입력하는 동안 토큰 위치를 바로 표시할 수 있습니다. 이 연결은 `src/lib/shared.ts`와 `metro.config.js`가 담당합니다.

## 오프라인 동작

조회 결과는 기기에 저장되어 연결 없이도 보입니다. 쓰기(추가·완료·수정·삭제·습관 체크·집중 기록)는 화면에 먼저 반영되고, 서버에 닿지 않으면 대기했다가 연결되면 만든 순서대로 전송됩니다. 앱을 껐다 켜도 대기 중인 쓰기는 유지되며, 오프라인 상태로 앱을 열어도 로그인 상태가 유지됩니다. 새 항목은 기기에서 만든 ID를 쓰므로 재전송해도 중복되지 않습니다. 기기의 데이터는 로그아웃하거나 다른 계정으로 로그인할 때만 지워집니다.

## 인앱 업데이트

1. 서버의 `/app/version`을 확인하고, 릴리스 정보가 없거나 서버에 닿지 않으면 GitHub Releases의 최신 릴리스를 확인합니다.
2. 설치된 빌드 번호보다 새 릴리스가 있으면 오늘 화면 상단과 설정에 알립니다.
3. Android: "지금 업데이트"를 누르면 설치 권한을 확인하고(없으면 설정 화면으로 안내하고 돌아오면 자동으로 이어감), APK를 진행률과 함께 내려받은 뒤, 같은 앱·같은 서명·더 높은 버전인지 검사하고 시스템 설치 화면을 엽니다.

내려받는 주소는 이 앱의 릴리스 저장소(`EXPO_PUBLIC_GITHUB_REPO`, 기본값 `ggumtak/dayframe`)의 `releases/download/...apk`만 허용합니다.

## 빌드와 릴리스

`android/` 폴더는 저장소에 없으며 `npx expo prebuild`가 `app.config.ts`로부터 만듭니다.

릴리스는 저장소 루트의 `.github/workflows/build-android-apk.yml`이 담당합니다.

| 실행 조건 | 결과 |
| --- | --- |
| `v1.2.3` 태그 푸시 | APK 빌드 → 서명·버전·권한 검증 → GitHub Release에 `dayframe.apk` 게시 |
| Pull Request, 수동 실행 | 같은 APK를 빌드해 에뮬레이터에서 실행해 보고, 결과물은 아티팩트로만 보관 |

버전은 태그에서 정해집니다. `v1.2.3`은 버전 이름 `1.2.3`, 빌드 번호 `10203`이 됩니다.

EAS를 쓰려면 `eas.json`의 `preview` 프로필이 APK를 만듭니다: `npx eas-cli@latest build -p android --profile preview`.

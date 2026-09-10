# PackPost 무료 배포 가이드

이 앱은 아래 조합으로 인프라 비용 0원, 카드 등록 없이 운영할 수 있습니다.

| 용도 | 서비스 | 무료 한도 |
|---|---|---|
| DB | [Neon](https://neon.tech) (Postgres) | 0.5GB, compute autosuspend |
| 앱 백엔드 호스팅 | [Render](https://render.com) (Web Service, Docker) | 무료 티어, 카드 등록 불필요 |
| 보존 기간 정리 스케줄러 | [cron-job.org](https://cron-job.org) | 무료, 계정만 있으면 됨 |
| 스토어프론트 위젯 | Theme App Extension | Shopify가 자체 CDN으로 호스팅 |
| 랜딩페이지(선택) | GitHub Pages | 정적 페이지만 가능 — 앱 백엔드는 못 올림 |

Render를 고른 이유: 이 저장소에 이미 `Dockerfile`이 있고, Shopify가 이 React Router 템플릿에 대해 [공식 Render 튜토리얼](https://render.com/docs/deploy-shopify-app)을 제공합니다. Google Cloud Run도 상시 무료 티어가 있지만 활성화하려면 결제 계정(카드)을 등록해야 해서, CLI 설치 없이 카드 없이 바로 시작할 수 있는 Render가 더 간편합니다.

## 0. 사전 준비
- [Shopify Partner 계정](https://partners.shopify.com) (무료)
- [Neon 계정](https://neon.tech) (무료)
- [Render 계정](https://render.com) (무료, 카드 불필요) — GitHub 계정으로 가입 가능
- 이 프로젝트를 GitHub 저장소에 올려두기 (Render는 git 저장소를 연결해서 배포함)
- `npm install -g @shopify/cli` (또는 `npx shopify`) — 로컬 개발/배포용, 호스팅과는 무관

## 1. Neon DB 생성 (Test/Prod DB 분리)
1. Neon 대시보드에서 새 프로젝트 생성 (리전은 서울에서 가까운 아시아 리전 권장) — 기본으로 만들어지는 브랜치가 `production`입니다. 이 연결 문자열은 Render(운영) 환경변수에만 씁니다.
2. 같은 프로젝트에서 **Branches → Create branch**로 `production`에서 분기한 `development` 브랜치를 하나 더 만듭니다. Neon 브랜치는 부모의 스키마/데이터를 복제한 독립 DB라서, 로컬에서 마음껏 테스트하다 데이터를 망가뜨려도 운영 DB엔 영향이 없습니다.
3. 각 브랜치의 **Pooled connection string**을 복사해서:
   - `development` 브랜치 → 로컬 `.env`의 `DATABASE_URL`
   - `production` 브랜치 → 4단계 Render 배포 시 `DATABASE_URL` 환경변수
4. `npx prisma migrate deploy`는 두 브랜치 모두에 각각 실행해야 합니다 (스키마 변경할 때마다 dev에서 먼저 검증 후 prod에 반영하는 흐름을 권장).

## 2. Shopify 앱 연결
```bash
cd delivery
shopify app config link
```
- Partner 대시보드에서 새 앱 생성 여부를 물으면 "Create a new app" 선택
- 완료되면 `shopify.app.toml`의 `client_id`가 채워집니다

`shopify.app.toml`의 `[app_proxy]` 섹션 `url` 값을 실제 배포 URL로 바꿔주세요 (현재 `https://REPLACE_WITH_APP_URL/proxy` 플레이스홀더):
```toml
[app_proxy]
url = "https://<your-render-url>.onrender.com/proxy"
subpath = "packpost"
prefix = "apps"
```

## 3. 로컬에서 먼저 확인
```bash
npm install
npx prisma migrate deploy   # Neon(development 브랜치)에 테이블 생성
npm run dev                  # shopify app dev — 개발 스토어에 임시 설치 후 UI 확인
```

## 4. Render 배포
1. Render 대시보드 → **New → Web Service**
2. 이 프로젝트가 있는 GitHub 저장소 선택
3. **Runtime**을 `Docker`로 선택 (저장소의 `Dockerfile`을 그대로 사용합니다)
4. **Instance Type**은 `Free` 선택
5. **Environment Variables**에 아래 값을 등록:
   - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES=read_orders`
   - `DATABASE_URL` = Neon `production` 브랜치의 pooled connection string
   - `NODE_ENV=production`
   - `SHOPIFY_APP_URL`은 일단 비워두고 배포 먼저 진행 (URL을 받은 뒤 다음 단계에서 채움)
6. **Create Web Service**로 첫 배포 실행 → 완료되면 `https://<서비스이름>.onrender.com` 형태의 URL이 발급됩니다.
7. 이 URL을 아래 세 곳에 반영합니다:
   - Render 환경변수 `SHOPIFY_APP_URL`
   - `shopify.app.toml`의 `application_url`, `[auth].redirect_urls`, `[app_proxy].url`
   - Partner 대시보드 App URL / Allowed redirection URLs (`shopify app config link` 이후엔 `npm run deploy`로 동기화됨)
8. 환경변수 변경 후 Render에서 재배포(Manual Deploy)

## 5. 앱 배포 & 확장 등록
```bash
npm run deploy   # shopify app deploy — webhook 구독 + 테마 익스텐션을 Shopify에 등록
```

## 6. 스토어프론트에 위젯 추가
개발 스토어 테마 편집기 → 아무 페이지(예: "주문조회" 커스텀 페이지) → 앱 블록 추가 → "PackPost 배송 타임라인" 선택.

## 7. 보존 기간 자동 삭제 (cron-job.org)
개인정보처리방침에 "주문 타임라인은 최대 24개월 보관 후 삭제"라고 명시했으므로, 이를 실제로 지키는 정리(cleanup) 작업을 예약합니다.

1. 시크릿 값을 하나 생성합니다 (PowerShell): `-join ((48..57)+(97..102)|Get-Random -Count 32|%{[char]$_})`
2. Render 서비스의 환경변수에 `CLEANUP_SECRET=<생성한 값>` 추가 후 재배포
3. [cron-job.org](https://cron-job.org)에 무료 가입 후 새 cronjob 생성:
   - URL: `https://<your-render-url>.onrender.com/internal/cleanup`
   - Method: `POST`
   - Schedule: 매일 1회 (예: 매일 03:00)
   - Request Headers에 `x-cleanup-secret: <생성한 값>` 추가
4. `/internal/cleanup`은 헤더의 시크릿이 일치할 때만 동작하며, `updatedAt` 기준 24개월이 지난 `OrderTimeline`(및 연결된 `StageUpdate` 이력)을 삭제합니다. 보관 기간을 바꾸려면 [app/models/timeline.server.ts](app/models/timeline.server.ts)의 `RETENTION_MONTHS` 값을 수정하세요.

## 참고
- Neon compute가 idle 후 첫 요청은 1~2초 느릴 수 있습니다 (무료 티어 특성) — 초기 트래픽에서는 무시 가능한 수준입니다.
- Render 무료 웹서비스는 15분간 요청이 없으면 슬립되고, 다음 요청에서 깨어나는 데 30~60초가 걸립니다. Shopify 웹훅은 실패/타임아웃 시 최대 48시간 동안 재시도하므로 데이터가 유실되진 않지만, 셀러가 오랜만에 앱을 열 때 첫 로딩이 느릴 수 있습니다. 트래픽이 늘어나면 유료 플랜(슬립 없음)으로 옮기는 걸 고려하세요.
- 위 7번 cron-job.org 핑을 `/app`이 아니라 `/internal/cleanup`으로만 보내는 이유: 이 엔드포인트로 15분보다 짧은 주기로 핑을 보내면 사실상 "keep-alive" 역할도 해서 슬립을 줄일 수 있지만, 그럴수록 무료 사용량을 더 쓰게 되니 정리 목적 그대로 하루 1회 정도로 유지하는 걸 권장합니다.

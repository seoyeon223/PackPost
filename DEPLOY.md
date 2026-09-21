# PackPost 배포 가이드

이 앱은 아래 조합으로 운영합니다.

| 용도 | 서비스 | 비용 |
|---|---|---|
| DB | [Neon](https://neon.tech) (Postgres) | 무료 티어, 0.5GB, compute autosuspend |
| 앱 백엔드 호스팅 | [Azure Container Apps](https://azure.microsoft.com/products/container-apps) (Consumption plan) | 매월 자체 무료 사용량(vCPU/메모리/요청 수) + GitHub Student Developer Pack $100 크레딧 |
| 보존 기간 정리 스케줄러 | [cron-job.org](https://cron-job.org) | 무료, 계정만 있으면 됨 |
| 스토어프론트 위젯 | Theme App Extension | Shopify가 자체 CDN으로 호스팅 |
| 랜딩페이지(선택) | GitHub Pages | 정적 페이지만 가능 — 앱 백엔드는 못 올림 |

Azure Container Apps를 고른 이유: 이 저장소에 이미 `Dockerfile`이 있어 그대로 재사용할 수 있고, Consumption plan은 트래픽이 없을 때 `--min-replicas 0`으로 완전히 스케일 다운되어 이 앱처럼 트래픽이 적은 경우 매달 무료 사용량 안에서 대부분 해결됩니다(학생팩 크레딧이 소진된 뒤에도).

> **Azure for Students 구독 관련 주의사항 (실제로 겪은 제약)**
> - **리전 제한**: 구독에 "Allowed resource deployment regions" 정책이 걸려 있어 `koreacentral`/`japaneast` 등 흔한 리전이 막혀있을 수 있습니다. 아래 명령으로 허용된 리전 목록을 먼저 확인하세요:
>   ```powershell
>   az policy assignment list --query "[?name=='sys.regionrestriction'].parameters.listOfAllowedLocations.value" -o tsv
>   ```
>   이 가이드는 그 목록에서 한국과 가장 가까웠던 `eastasia`(홍콩)를 기준으로 작성했습니다. 목록이 다르게 나오면 아래 모든 `--location eastasia`를 본인 목록의 리전으로 바꿔주세요.
> - **ACR Tasks(클라우드 빌드) 차단**: `az acr build`(로컬 Docker 없이 클라우드에서 이미지 빌드)가 `TasksOperationsNotAllowed` 에러로 막혀 있었습니다. 그래서 아래 4-3단계는 **로컬 Docker Desktop으로 빌드 후 푸시**하는 방식으로 안내합니다.

## 0-1. 사전 진단 체크리스트 (건너뛰지 마세요)
아래 두 가지를 미리 확인해두면 4단계에서 막히는 일이 줄어듭니다.
- Docker Desktop이 설치되어 있고 켜져 있는지: `docker ps` (에러 없이 컨테이너 목록이 나와야 함)
- `az login` 후 어떤 리전이 허용되는지: 위 `az policy assignment list` 명령

## 0. 사전 준비
- [Shopify Partner 계정](https://partners.shopify.com) (무료)
- [Neon 계정](https://neon.tech) (무료)
- Azure 계정 (GitHub Student Developer Pack의 $100 크레딧을 연결해둔 구독)
- Azure CLI 설치 (Windows PowerShell):
  ```powershell
  winget install -e --id Microsoft.AzureCLI
  ```
- `npm install -g @shopify/cli` (또는 `npx shopify`) — 로컬 개발/배포용, 호스팅과는 무관

## 1. Neon DB 생성 (Test/Prod DB 분리)
1. Neon 대시보드에서 새 프로젝트 생성 (리전은 서울에서 가까운 아시아 리전 권장) — 기본으로 만들어지는 브랜치가 `production`입니다. 이 연결 문자열은 Azure(운영) 환경변수에만 씁니다.
2. 같은 프로젝트에서 **Branches → Create branch**로 `production`에서 분기한 `development` 브랜치를 하나 더 만듭니다. Neon 브랜치는 부모의 스키마/데이터를 복제한 독립 DB라서, 로컬에서 마음껏 테스트하다 데이터를 망가뜨려도 운영 DB엔 영향이 없습니다.
3. 각 브랜치의 **Pooled connection string**을 복사해서:
   - `development` 브랜치 → 로컬 `.env`의 `DATABASE_URL`
   - `production` 브랜치 → 4단계 Azure 배포 시 `DATABASE_URL` 시크릿
4. `npx prisma migrate deploy`는 두 브랜치 모두에 각각 실행해야 합니다 (스키마 변경할 때마다 dev에서 먼저 검증 후 prod에 반영하는 흐름을 권장).

## 2. Shopify 앱 연결
```bash
cd delivery
shopify app config link
```
- Partner 대시보드에서 새 앱 생성 여부를 물으면 "Create a new app" 선택
- 완료되면 `shopify.app.toml`의 `client_id`가 채워집니다

`shopify.app.toml`의 `[app_proxy]` 섹션 `url` 값은 4단계에서 Container App의 실제 URL을 발급받은 뒤 채웁니다 (지금은 플레이스홀더 그대로 둬도 됩니다):
```toml
[app_proxy]
url = "https://<your-app-name>.<random>.<region>.azurecontainerapps.io/proxy"
subpath = "packpost"
prefix = "apps"
```

## 3. 로컬에서 먼저 확인
```bash
npm install
npx prisma migrate deploy   # Neon(development 브랜치)에 테이블 생성
npm run dev                  # shopify app dev — 개발 스토어에 임시 설치 후 UI 확인
```

## 4. Azure Container Apps 배포
### 4-1. 로그인 및 리소스 그룹
```powershell
az login
# 계정 선택 창에 원하는 계정이 안 보이면: az login --use-device-code
az account set --subscription "<학생 크레딧이 연결된 구독 이름 또는 ID>"

az group create --name packpost-rg --location eastasia
```
> `eastasia`가 안 되면 0-1단계의 `az policy assignment list` 명령으로 실제 허용된 리전을 확인해서 바꿔주세요.

### 4-2. 필요한 확장/프로바이더 등록 (최초 1회)
```powershell
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
az provider register --namespace Microsoft.ContainerRegistry

# 등록이 끝날 때까지 폴링 (몇 분 걸릴 수 있음)
foreach ($ns in "Microsoft.App","Microsoft.OperationalInsights","Microsoft.ContainerRegistry") {
  do {
    $state = az provider show -n $ns --query registrationState -o tsv
    Start-Sleep -Seconds 5
  } while ($state -ne "Registered")
  Write-Output "$ns -> $state"
}
```

### 4-3. 컨테이너 이미지 빌드 (로컬 Docker 필요)
Azure for Students 구독은 ACR Tasks(`az acr build`, 클라우드 빌드)가 막혀 있는 경우가 많습니다. Docker Desktop을 켜둔 상태에서 로컬 빌드 → 푸시로 진행하세요.
```powershell
# ACR 이름은 전역에서 고유해야 하므로 뒤에 임의 문자열을 붙이세요 (영문 소문자/숫자만)
az acr create --resource-group packpost-rg --name packpostacr --sku Basic --location eastasia

# (선택) 먼저 시도해보고, TasksOperationsNotAllowed 에러가 나면 바로 아래 로컬 빌드로 넘어가세요
az acr build --registry packpostacr --image packpost:latest .
```
```powershell
# 로컬 Docker 빌드 + 푸시
docker ps    # 에러가 나면 Docker Desktop을 먼저 켜세요
az acr login --name packpostacr
docker build -t packpostacr.azurecr.io/packpost:latest .
docker push packpostacr.azurecr.io/packpost:latest
```

### 4-4. Container Apps 환경 및 앱 생성
```powershell
az containerapp env create --name packpost-env --resource-group packpost-rg --location eastasia

# ACR pull 자격 증명 확보 (가장 간단한 admin 자격 증명 방식)
az acr update --name packpostacr --admin-enabled true
$acrPassword = az acr credential show --name packpostacr --query "passwords[0].value" -o tsv
```

> **Windows(`az.cmd`) 특유의 함정**: Windows에서 `az`는 배치 파일(`az.cmd`)이라 내부적으로 `cmd.exe`를 거칩니다. Neon 연결 문자열처럼 값에 **`&`가 들어있으면**, PowerShell이 공백이 없는 인자엔 따옴표를 안 붙이는 것과 맞물려 `cmd.exe`가 `&` 뒤를 **별개의 명령어로 쪼개버립니다** (예: `...sslmode=require&channel_binding=require` → `channel_binding=require`가 잘려나가고 `'channel_binding' is not recognized...` 에러가 뒤에 따라붙음). 이 경우 시크릿 값이 잘려서 저장되므로, 아래처럼 **값 자체를 큰따옴표로 한 번 더 감싸서** 넘기세요.

여러 줄 백틱(`` ` ``) 이어쓰기도 뒤 인자를 누락시키는 경우가 있었으니, 인자가 많을 땐 배열로 만들어 `& az @args`로 호출하는 쪽이 더 안전합니다:
```powershell
$dbUrl = '"' + "<Neon production 브랜치 pooled connection string>" + '"'   # 바깥 큰따옴표 보존
$shopifySecret = "<Partner 대시보드 Client secret>"

$createArgs = @(
  "containerapp", "create",
  "--name", "packpost",
  "--resource-group", "packpost-rg",
  "--environment", "packpost-env",
  "--image", "packpostacr.azurecr.io/packpost:latest",
  "--registry-server", "packpostacr.azurecr.io",
  "--registry-username", "packpostacr",
  "--registry-password", $acrPassword,
  "--target-port", "3000",
  "--ingress", "external",
  "--min-replicas", "0",
  "--max-replicas", "1",
  "--secrets", "database-url=$dbUrl", "shopify-api-secret=$shopifySecret",
  "--env-vars",
    "SHOPIFY_API_KEY=<Partner 대시보드 Client id>",
    "SHOPIFY_API_SECRET=secretref:shopify-api-secret",
    "SCOPES=read_orders",
    "DATABASE_URL=secretref:database-url",
    "NODE_ENV=production"
)
& az @createArgs
```
- `--min-replicas 0`: 요청이 없으면 0개 인스턴스로 완전히 줄어들어(Render 무료 티어의 "슬립"과 비슷) 유휴 상태에서 비용이 들지 않습니다. 다음 요청에서 콜드 스타트가 걸립니다.
- 비밀번호/시크릿류(`DATABASE_URL`, `SHOPIFY_API_SECRET`)는 `--secrets`로 등록하고 `--env-vars`에서 `secretref:`로 참조해 평문 노출을 피합니다.
- 명령 실행 후 반드시 `az containerapp show --name packpost --resource-group packpost-rg --query "properties.template.containers[0].env"`로 env var가 다 들어갔는지, `az monitor log-analytics query`(4-7 참고)로 DB 연결이 되는지 확인하세요. "성공" 메시지가 떠도 일부 인자가 잘렸을 수 있습니다.

### 4-5. 발급된 URL을 코드/설정에 반영
```powershell
$fqdn = az containerapp show --name packpost --resource-group packpost-rg --query properties.configuration.ingress.fqdn -o tsv
az containerapp update --name packpost --resource-group packpost-rg --set-env-vars SHOPIFY_APP_URL="https://$fqdn"
"https://$fqdn"
```
이 URL을 아래 세 곳에 반영합니다:
- `shopify.app.toml`의 `application_url`, `[auth].redirect_urls`, `[app_proxy].url`
- Partner 대시보드 App URL / Allowed redirection URLs — `npm run deploy -- --allow-updates`로 동기화 (아래 5단계). 대화형 터미널이 아니면 `--allow-updates`(또는 `--allow-deletes`/`--no-release`) 중 하나를 꼭 붙여야 합니다.
- (참고용) 위 명령이 이미 Container App의 `SHOPIFY_APP_URL` 환경변수에 반영했습니다

### 4-6. 코드 변경 후 재배포
```powershell
docker build -t packpostacr.azurecr.io/packpost:latest .
docker push packpostacr.azurecr.io/packpost:latest
az containerapp update --name packpost --resource-group packpost-rg --image packpostacr.azurecr.io/packpost:latest
```
Render처럼 git push에 맞춰 자동 배포되진 않습니다 — 매번 이 명령들을 실행하거나, 나중에 여유가 생기면 [Azure Container Apps용 GitHub Actions](https://learn.microsoft.com/azure/container-apps/github-actions) 워크플로로 자동화할 수 있습니다.

### 4-7. 문제 생겼을 때 로그 보기
`az containerapp logs show`가 `KeyError: 'eventStreamEndpoint'`로 죽는 경우가 있습니다 — 이때는 Log Analytics를 직접 쿼리하세요:
```powershell
az extension add --name log-analytics --yes
$workspaceId = az monitor log-analytics workspace show --resource-group packpost-rg --workspace-name <워크스페이스 이름> --query customerId -o tsv
# 워크스페이스 이름은 `az monitor log-analytics workspace list --resource-group packpost-rg -o table`로 확인 (보통 workspace-packpostrgXXXX)

az monitor log-analytics query --workspace $workspaceId --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'packpost' | order by TimeGenerated desc | take 50 | project TimeGenerated, Log_s" -o table
```
또한 `az containerapp revision restart`가 `(InternalServerError)`로 실패하는 경우가 있었습니다 — 이때는 `az containerapp update --set-env-vars NODE_ENV=production` 같은 사소한 값 재설정으로 새 revision을 강제로 띄우면 우회됩니다.

## 5. 앱 배포 & 확장 등록
```bash
npm run deploy                          # 대화형 터미널: 변경 사항 확인 프롬프트가 뜸
npx shopify app deploy --allow-updates  # 비대화형(CI, 에이전트 등): 확인 없이 진행
```
webhook 구독 + 테마 익스텐션 + (4-5단계에서 바꾼) App URL/redirect URL을 Shopify Partner 대시보드에 반영합니다.

## 6. 스토어프론트에 위젯 추가
개발 스토어 테마 편집기 → 아무 페이지(예: "주문조회" 커스텀 페이지) → 앱 블록 추가 → "PackPost 배송 타임라인" 선택.

## 7. 보존 기간 자동 삭제 (cron-job.org)
개인정보처리방침에 "주문 타임라인은 최대 24개월 보관 후 삭제"라고 명시했으므로, 이를 실제로 지키는 정리(cleanup) 작업을 예약합니다.

1. 시크릿 값을 하나 생성합니다 (PowerShell): `-join ((48..57)+(97..102)|Get-Random -Count 32|%{[char]$_})`
2. Container App에 시크릿으로 등록 후 환경변수로 연결합니다:
   ```powershell
   az containerapp secret set --name packpost --resource-group packpost-rg --secrets cleanup-secret="<생성한 값>"
   az containerapp update --name packpost --resource-group packpost-rg --set-env-vars CLEANUP_SECRET=secretref:cleanup-secret
   ```
3. [cron-job.org](https://cron-job.org)에 무료 가입 후 새 cronjob 생성:
   - URL: `https://<발급받은 azurecontainerapps.io 주소>/internal/cleanup`
   - Method: `POST`
   - Schedule: 매일 1회 (예: 매일 03:00)
   - Request Headers에 `x-cleanup-secret: <생성한 값>` 추가
4. `/internal/cleanup`은 헤더의 시크릿이 일치할 때만 동작하며, `updatedAt` 기준 24개월이 지난 `OrderTimeline`(및 연결된 `StageUpdate` 이력)을 삭제합니다. 보관 기간을 바꾸려면 [app/models/timeline.server.ts](app/models/timeline.server.ts)의 `RETENTION_MONTHS` 값을 수정하세요.

## 8. 요금제 (Shopify Managed Pricing)
- Free: 월 50건 주문까지, 위젯에 "Powered by PackPost" 배지
- Pro: $6.99/월, 주문 수 제한 없음, 배지 제거
- Partner 대시보드의 Pricing 섹션에 이 두 plan을 **public plan으로 등록해야 앱스토어 리스팅이 통과됩니다.** public plan이 하나라도 등록되면 앱이 자동으로 "Shopify App Pricing"(관리형) 모드가 되어, 앱이 직접 `billing.request()`/`billing.cancel()`을 호출하는 게 막힙니다 — 그래서 플랜 업그레이드/해지는 앱 코드가 아니라 Shopify의 자체 플랜 관리 화면에서 이루어집니다.
- 관리자 화면의 **요금제** 메뉴(`/app/billing`)는 `billing.check()`로 현재 플랜만 읽어서 보여주는 용도입니다 (주문 한도/배지 제거 여부를 여기서 판단).

## 참고
- Neon compute가 idle 후 첫 요청은 1~2초 느릴 수 있습니다 (무료 티어 특성) — 초기 트래픽에서는 무시 가능한 수준입니다.
- `--min-replicas 0`으로 배포한 Container App은 요청이 없으면 인스턴스가 0개로 줄어들고, 다음 요청에서 다시 뜨는 데 수 초에서 수십 초가 걸릴 수 있습니다(콜드 스타트). Shopify 웹훅은 실패/타임아웃 시 최대 48시간 동안 재시도하므로 데이터가 유실되진 않지만, 셀러가 오랜만에 앱을 열 때 첫 로딩이 느릴 수 있습니다. 트래픽이 늘어나면 `--min-replicas 1`로 올려 상시 기동시키는 걸 고려하세요(그만큼 사용량이 늘어 무료 grant를 넘기면 비용이 발생합니다).
- 위 7번 cron-job.org 핑을 `/app`이 아니라 `/internal/cleanup`으로만 보내는 이유: 이 엔드포인트로 짧은 주기로 핑을 보내면 사실상 "keep-alive" 역할도 해서 콜드 스타트를 줄일 수 있지만, 그럴수록 무료 사용량을 더 쓰게 되니 정리 목적 그대로 하루 1회 정도로 유지하는 걸 권장합니다.
- 사용량/크레딧 소진 현황은 Azure Portal → **Cost Management + Billing**에서 확인할 수 있습니다. 학생팩 크레딧은 통상 활성화 후 12개월간 유효하니 만료일을 캘린더에 표시해두는 걸 추천합니다.
- `.env`나 시크릿 값을 터미널/채팅에 출력해서 확인하고 싶을 땐 값을 마스킹하는 스크립트를 직접 짜기보다, 아예 값을 출력하지 않고(예: `$value.Length`로 길이만 확인) 필요한 곳에 바로 주입하는 편이 안전합니다. 어설픈 마스킹 정규식은 일부만 가리고 나머지를 그대로 노출시킬 수 있습니다 — 값이 실수로 한 번이라도 노출됐다면 Neon/Shopify 양쪽 다 즉시 재발급(rotate)하세요.

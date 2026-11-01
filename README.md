# ✦ Overleaf AI — Claude / Codex CLI 논문 작성 확장

**overleaf.com 프로젝트 페이지에서만** 켜지는 Chrome 확장입니다. 이 컴퓨터에 설치된
**Claude Code CLI(`claude`)** 또는 **OpenAI Codex CLI(`codex`)** 로 LaTeX 원고를 쓰고, 고치고, 검토합니다.
API 키 없이 각 CLI에 로그인된 구독·계정을 그대로 씁니다.

기능을 어떻게 골랐는지(경쟁 제품 비교 포함)는 [docs/FEATURES.md](docs/FEATURES.md)에,
결함 분석과 처리 현황·남은 과제는 [docs/ANALYSIS.md](docs/ANALYSIS.md)에 있습니다.

## 주요 기능

| 분류 | 기능 |
| --- | --- |
| **에이전트** | 여러 단계 작업을 맡기면 Claude 가 **프로젝트 파일 목록·읽기·검색, 컴파일 로그, 로컬 점검, 문헌 DB 조회**를 스스로 쓰고, 수정은 **제안 카드**로 올립니다(승인해야 적용). 대화가 이어지며, 이전 제안의 적용·거절 결과를 에이전트가 압니다 |
| **자동완성** | 입력을 멈추면 회색 제안 표시 → `Tab` 수락, `⌘/Ctrl+→` 단어 수락, `Esc` 닫기. 수동 모드는 `Alt(⌥)+\` |
| **교정** | 다듬기 · 문법 교정 · **한국어 맞춤법** · **학위논문 문체** · 학술체로 · 간결하게 · 명료하게 · 문장 나누기/합치기 · 흐름 개선 · 주장 완화/단정 · 능동태 · 상투 표현 제거 · 다른 표현 3개 · 단어 대안 |
| **작성** | 이어쓰기 · 메모→문단 · 구체화 · 주제문 강화 · 연결 문장 · 제목 후보 · 초록 · 기여점 · 결론 · 한계점 · 키워드 · 하이라이트 · 리뷰 답변 · 커버레터 |
| **LaTeX** | LaTeX 수정 · **컴파일 오류 해결**(로그를 읽어 원인 설명과 수정안) · 표/수식/그림/알고리즘/TikZ 만들기 · 캡션 개선 · 수식 설명 · BibTeX 정리 · 참고문헌→BibTeX |
| **BibTeX 관리** (공식 메타데이터, AI 없음) | **BibTeX 추가**(DOI·arXiv·제목 → `.bib` + `\cite{키}`) · **누락 인용 채우기**(원고의 `\cite` 키 중 `.bib`에 없는 것) · **arXiv → 출판본 정정**(학회·저널 게재 확인 후 같은 키로 교체) · **BibTeX 점검**(중복·미사용·필드 누락·대문자 보호) |
| **문헌** (웹 검색) | 인용 필요 위치 · **관련 문헌 찾기**(실재가 확인된 논문 + BibTeX) · **참고문헌 검증** |
| **검토** | 리뷰어 시뮬레이션 · 논리·주장 점검 · 용어·표기 일관성 · 명료성 점검 · 역개요 · 제출 전 점검 · **기호 표** · **약어 목록** · 한국어로 설명 · 쉬운 요약 |
| **번역** | 한→영 · 영→한 · 한글 초안→영문 · 역번역 검증 |
| **점검** (AI 없이 즉시) | 문제 목록(라벨/참조/인용/환경/중괄호/캡션/약어/표기 혼용/누락 패키지 등) · **용어 통일**(문서 전체 일괄 교체) · **필요한 패키지**(프리앰블 자동 추가) · **분량·익명화**(절별 단어 수, 초록·그림·표·인용 수, 프로젝트 전체 합계, 이중맹검 위반 탐지) · 용어집 제안(AI) |

그 밖의 기능:
- **모델·사고 수준 선택**: Claude Fable 5.1 / **Opus 5.5(기본)** / Sonnet 5.5 / Haiku 5.5 / 이전 세대 / 사용자 지정, Codex 모델. 사고 수준은 자동(교정 low · 작성 medium · 검토 high) 또는 low~max 중에서 고릅니다.
- **결과 다듬기**: 결과 아래 입력칸에 "더 짧게", "두 번째 문장은 원문 유지"처럼 쓰면 같은 대상에 대해 이어서 고칩니다.
- **우클릭 메뉴**: 에디터에서 텍스트를 선택하고 우클릭 → *Overleaf AI* → 다듬기·문법·간결하게·번역·맞춤법·설명·인용 필요 위치·에이전트에게 맡기기.
- **사용량**: 패널 아래에 오늘 요청 수와 CLI 가 보고한 추정 비용, 설정 페이지에 최근 7일 합계(이 기기에만 저장, 30일 후 삭제).
- **결과 처리**: 스트리밍 미리보기, **변경 단위 수락/거절**, 결과 직접 편집, 교체/원문 아래 추가/삽입, 후보 카드, 보고서의 `L42` 링크를 누르면 해당 줄로 이동, 주석으로 삽입, 실행 기록.
- **기입 요청**: AI가 만든 표·알고리즘·TikZ를 적용하면, 그 결과에 필요한데 프리앰블에 없는 패키지를 알려 주고 바로 추가할 수 있습니다.
- **논문 정보**(프로젝트별): 타깃 venue, 분야, 독자, US/UK 철자, **심사 방식(이중맹검이면 익명화 문제를 문제 목록에 포함)**, 용어집, 메모. 모든 요청과 용어 통일에 반영됩니다.
- **`% ai:` 지시문**: 원고에 `% ai: 실험 설정 문단 작성` 이라고 쓰고 실행하면 그 줄이 결과로 바뀝니다.
- 모든 적용은 별도 실행 취소 단계라 `⌘/Ctrl+Z` 한 번으로 되돌릴 수 있습니다. 생성 중에 문서가 바뀌면 앞뒤 문맥으로 원문 위치를 다시 찾고, 위치가 애매하거나 사라졌거나 다른 파일이면 적용하지 않습니다. 읽기 전용 문서에는 적용하지 않습니다.
- **적용 전 안전 검사**: AI 결과에서 원문의 `\cite`·`\ref`·`\label`·수식이 빠졌거나, 원문·문서에 없던 숫자나 인용이 생겼거나, 중괄호·환경 짝이 깨졌으면 경고합니다. 경고가 있으면 빠른 실행의 자동 적용도 멈춥니다.

## 구조

```
 overleaf.com 탭
 ┌──────────────────────────────────────────┐
 │ main-world.js  (페이지 MAIN world)        │  CodeMirror 6 EditorView 탐색, 읽기/적용,
 │   ↑↓ window.postMessage                  │  자동완성 고스트 텍스트(Tab/⌘→/Esc)
 │ content.js     (격리 world, Shadow DOM)   │  패널 UI · 실행 흐름 · 자동완성 트리거
 │  catalog / prompts / lint / terms /      │  (순수 함수 모듈, Node 에서 단위 테스트)
 │  packages / diff / markdown              │
 └───────────────┬──────────────────────────┘
                 │ chrome.runtime.connect
         background.js (서비스 워커)
                 │ chrome.runtime.connectNative("com.olai.cli_bridge")
         host/host.js  (Node, Native Messaging 호스트)
                 │ spawn (셸 사용 안 함)
         claude -p --output-format stream-json --tools ""        (문헌 기능만 WebSearch,WebFetch)
         codex exec --sandbox read-only -o <file> -

 에이전트 모드:
         claude -p --tools "" --mcp-config <0600 파일> --strict-mcp-config --allowedTools mcp__overleaf__*
                 │ stdio (MCP)
         host/mcp-server.js ──(0600 유닉스 소켓)──▶ host.js ──Native Messaging──▶ 확장(content.js 가 도구 실행)
```

브라우저 확장은 보안상 로컬 프로그램을 직접 실행할 수 없어서, Chrome 공식 방식인
[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
호스트가 CLI를 대신 실행합니다. 요청마다 호스트 프로세스가 하나 뜨고, `중지`를 누르거나 계속 타이핑하면 해당 CLI도 종료됩니다.

## 설치

필요한 것: macOS 또는 Linux(Windows 는 아래 참고), Node.js 18+, Chrome 계열 브라우저, 그리고 `claude` 또는 `codex` 중 하나 이상(자동완성과 문헌 기능은 `claude` 필요).

1. **CLI 로그인 확인**: 터미널에서 `claude`(또는 `codex`)를 한 번 실행해 로그인되어 있는지 확인합니다.
2. **로컬 브리지 설치**
   ```bash
   ./scripts/install-host.sh
   ```
   - 호스트 파일을 `~/Library/Application Support/overleaf-ai-host/`에 복사합니다. `~/Desktop` 같은 보호 폴더 밖이라 macOS 권한 팝업이 뜨지 않습니다.
   - 로그인 셸의 `PATH`와 `node`·`claude`·`codex`의 절대 경로를 기록합니다.
   - 설치된 Chrome / Chromium / Brave / Edge / Vivaldi / Arc 모두에 호스트 매니페스트를 등록합니다.
3. **확장 로드**: `chrome://extensions`에서 *개발자 모드*를 켜고 *압축해제된 확장 프로그램을 로드* → 이 저장소의 `extension/` 폴더를 선택합니다. 확장 ID는 항상 `lbggnmchbhbpojfdpcfknoppbjpnmgnn`입니다.
4. Overleaf 프로젝트를 열면 오른쪽 아래에 **✦ AI** 버튼이 보입니다. 패널 제목 옆 점이 초록색이면 연결된 것입니다.

> **Windows (시험적)**: PowerShell 에서 `powershell -ExecutionPolicy Bypass -File scripts\install-host.ps1` 을 실행합니다. 호스트를 `%LOCALAPPDATA%\overleaf-ai-host`에 복사하고 Chrome·Edge·Brave·Chromium 레지스트리(HKCU)에 등록합니다. npm 으로 설치된 `claude.cmd` 는 셸 없이 실행할 수 없어 브리지가 내부의 `cli.js`를 node 로 직접 실행합니다. 개발자 환경에서 Windows 실기 검증은 하지 않았습니다. 제거는 `scripts\uninstall-host.ps1`.

> **업데이트할 때**: `git pull` 후 `./scripts/install-host.sh` 다시 실행 → `chrome://extensions`에서 확장 새로고침(⟳) → Overleaf 탭 새로고침. 설정 페이지에 브리지와 확장의 버전이 다르면 경고가 뜹니다.

## 에이전트 (에이전트 탭)

"서론을 리뷰어 코멘트 3번에 맞게 고쳐줘", "원고 전체에서 dataset/data set 표기를 통일해줘", "컴파일 오류를 고쳐줘", "관련 연구 절에 빠진 인용을 찾아 넣어줘"처럼 **여러 파일을 보고 여러 번 고쳐야 하는 일**을 맡깁니다.

- Claude Code 의 에이전트 루프를 그대로 쓰되, 내장 도구(파일·셸·웹)는 모두 끄고 **이 확장이 제공하는 Overleaf 도구만** 쓰게 합니다.

| 도구 | 하는 일 |
| --- | --- |
| `list_files` · `read_file` · `search_project` | 프로젝트 파일 목록, 파일 읽기(줄 번호·범위), 정규식/문자열 검색 |
| `get_editor_state` | 현재 파일·커서·선택 영역 |
| `propose_edit` | 수정 **제안** 등록(원문이 파일에 정확히 한 번 있어야 함, 안전 검사 포함). 직접 쓰지 않음 |
| `get_compile_log` · `run_checks` | 마지막 컴파일 오류, 로컬 점검(문제 목록·용어·패키지·분량) |
| `bib_lookup` · `get_paper_profile` | arXiv·DOI·제목으로 공식 메타데이터 조회, 논문 정보(venue·용어집 등) |

- 제안은 diff 카드로 쌓이고 `적용`·`거절`·`모두 적용`으로 처리합니다. 적용 시 원문이 바뀌었으면 *원문 바뀜*으로 표시하고 적용하지 않습니다. 다른 파일이면 그 파일을 열어 적용한 뒤 돌아옵니다.
- 대화는 프로젝트별로 이어집니다(`새 대화`로 초기화). 세션 기록은 브리지 작업 폴더에만 있습니다.
- 한 번의 요청에서 도구 호출은 최대 40번, 제한 시간은 설정값과 10분 중 큰 값입니다. `웹 검색 허용`을 켜면 학술 도메인으로 제한된 WebSearch/WebFetch 도 씁니다.
- 에이전트는 Claude 백엔드 전용입니다(사용하는 모델은 상단 모델 선택을 따름).

## BibTeX 관리 (문헌 탭)

메타데이터는 LLM 추측이 아니라 공식 데이터베이스에서 가져옵니다: arXiv API, Semantic Scholar, OpenAlex, DOI(Crossref·DataCite 콘텐츠 협상), Crossref 검색. (DBLP 는 2026년 현재 봇 차단으로 쓰지 않습니다.)

- **BibTeX 추가**: DOI, arXiv ID/URL, 또는 제목을 넣고 찾기 → 후보(출처·연도·피인용 표시)에서 추가. arXiv 논문이면 출판본이 있는지 먼저 확인해 함께 보여 줍니다. `.tex`에서 실행하면 커서 위치에 `~\cite{키}`도 넣습니다.
- **누락 인용 채우기**: 프로젝트의 모든 `.tex`에서 `\cite`(natbib·biblatex 포함) 키를 모아 `.bib`에 없는 것을 찾고, 키 이름(`vaswani2017attention` → 저자·연도·단어)과 인용 문장 주변 단어로 후보를 찾습니다. **원래 키 그대로** 추가합니다.
- **arXiv → 출판본**: `journal={arXiv preprint …}`, `eprint`, CoRR, arXiv URL/DOI 로 인용한 항목마다 학회·저널 게재 여부를 교차 확인하고(제목 유사도·저자·연도), 확신이 높은 것만 미리 체크합니다. 같은 키로 교체하므로 본문 `\cite`는 그대로입니다. 각 항목의 변경 내용을 diff 로 볼 수 있습니다.
- **BibTeX 점검**: 같은 논문의 중복 항목(DOI·arXiv·제목), 같은 키 중복, 인용되지 않은 항목, 필수 필드 누락, `{}`로 보호되지 않은 약어(BERT, ImageNet, t-SNE)를 찾고 대문자 보호를 한 번에 적용합니다.
- `.bib`이 열려 있지 않으면 파일 트리에서 열어 적용한 뒤 원래 파일로 돌아옵니다(실패하면 복사).
- Semantic Scholar 는 공용 요청 한도가 자주 찹니다. 그러면 "일부만 확인"이라고 표시하니 잠시 뒤 다시 확인하거나, 브리지 `config.json`에 `"s2ApiKey"`를 넣으세요.

## 사용법

| 동작 | 방법 |
| --- | --- |
| 패널 열기/닫기 | `Alt+Shift+A`(mac `⌥⇧A`) 또는 ✦ AI 버튼 |
| 모델·사고 수준 | 패널 상단에서 바로 변경 |
| 기능 실행 | 분류 탭에서 고르거나 검색창에 "초록", "표", "인용"처럼 입력. 입력칸에 쓴 내용은 **추가 지시**로 함께 전달 |
| 범위 | `범위 자동`(선택 영역, 없으면 기능별 기본), `선택·문단`, `현재 섹션`, `파일 전체` |
| 직접 지시 | `수정·작성`(선택은 고치고 없으면 커서에 작성) / `질문·분석`(문서는 그대로 두고 답변만). `⌘/Ctrl+Enter` |
| 빠른 실행 | `Alt+Shift+I`: `% ai:` 지시문이 있으면 실행, 없으면 선택 영역·현재 문단에 기본 기능(다듬기) |
| 자동완성 | 패널 아래쪽에서 자동 / 수동(`Alt+\`) / 끔. `Tab` 수락 · `⌘/Ctrl+→` 단어 · `Esc` 닫기 |
| 결과 다듬기 | 결과 아래 입력칸에 추가 지시 → `다시 쓰기`(또는 Enter) |
| 우클릭 | 텍스트 선택 → 우클릭 → *Overleaf AI* 하위 메뉴 |
| 에이전트 | `에이전트` 탭에서 작업을 쓰고 `보내기`(`⌘/Ctrl+Enter`). 제안 카드를 승인해 적용 |
| 결과 적용 | `적용(교체)` · `원문 아래에 추가` · `커서 위치에 삽입`. 변경사항 탭에서 변경을 눌러 하나씩 빼거나 다시 넣을 수 있음 |
| 되돌리기 | 에디터에서 `⌘/Ctrl+Z` (용어 통일·패키지 추가도 한 번에 되돌림) |

단축키는 `chrome://extensions/shortcuts`에서 바꿀 수 있습니다.

**점검 탭**은 AI를 쓰지 않고 즉시 실행되며, 입력하는 동안 자동으로 다시 계산됩니다. AI 버튼의 숫자는 오류와 경고 개수입니다.
- *문제 목록*: 항목을 누르면 해당 줄로 이동합니다.
- *용어 통일*: 그룹마다 통일할 형태를 고르고 `선택한 그룹 통일`을 누릅니다. 용어집은 "논문 정보"에 직접 쓰거나 *용어집 제안(AI)* 결과를 `용어집에 저장 → 통일`로 넣습니다.
- *필요한 패키지*: 체크한 항목을 `프리앰블에 추가`합니다. 학회 템플릿(.sty/.cls)이 이미 불러온 패키지는 체크를 해제하세요.

## 설정 (패널의 ⚙ 또는 확장 아이콘 → 설정)

- **백엔드·모델·사고 수준**, 사용자 지정 모델 ID (CLI 추가 인자는 브리지 `config.json` 에서만)
- **자동완성**: 동작(자동/수동/끔), 모델(기본 Haiku 5.5), 사고 수준, 대기 시간, 최대 단어 수
- **글쓰기**: 추가 작성 규칙, 사용자 프리셋(`라벨 | 지시문 | 종류`), 검토 결과 언어(한국어/English), 문맥 길이, 제한 시간
- 웹 검색 허용(문헌 기능·에이전트), 입력 중 로컬 점검, 빠른 실행 기능과 바로 적용, AI 버튼 표시
- **사용량**: 최근 7일 요청 수·추정 비용

## 보안과 개인정보

- 확장은 `overleaf.com/project/*`에서만 실행되며, 권한은 `nativeMessaging`, `storage`, `contextMenus`(우클릭 메뉴, Overleaf 프로젝트 페이지에서만 표시) 세 개뿐입니다.
- 호스트 매니페스트의 `allowed_origins` 때문에 **이 확장만** 브리지를 쓸 수 있습니다. CLI는 셸을 거치지 않고 인자 배열로 실행됩니다.
- 생성 요청은 패널 클릭, 단축키, 에디터의 실제 키 입력(`isTrusted`)으로만 시작됩니다. 페이지 스크립트는 패널(닫힌 Shadow DOM)을 조작하거나 요청을 보낼 수 없습니다. 다만 페이지는 원래 문서를 가지고 있으므로, Overleaf 페이지 자체가 침해되면 문서 내용을 바꿔 프롬프트에 영향을 줄 수는 있습니다.
- **Claude**: `--tools ""`로 파일·셸·웹 도구를 모두 끄고, `--strict-mcp-config`로 MCP 서버를, `--settings '{"disableAllHooks":true}'`로 훅을, `CLAUDE_CODE_DISABLE_CLAUDE_MDS`·`CLAUDE_CODE_DISABLE_AUTO_MEMORY`로 CLAUDE.md·자동 메모리를 끄고, `--no-session-persistence`로 세션 기록을 남기지 않습니다. `--permission-mode dontAsk`를 명시해 사용자 기본 권한 모드(예: auto)가 다른 도구를 승인하지 못하게 합니다. 예외로 **웹 문헌 기능**만 `WebSearch`와 학술 도메인(arxiv.org, doi.org, aclanthology.org 등)으로 제한한 `WebFetch`를 켭니다(설정에서 끌 수 있음).
- **에이전트 모드**: 내장 도구는 `--tools ""`로 모두 끄고 `--strict-mcp-config`로 이 브리지의 MCP 서버 하나만 연결하며, `--allowedTools`는 `mcp__overleaf__*`(웹 허용 시 제한된 WebSearch/WebFetch 추가)뿐입니다. MCP 서버는 파일·네트워크 접근 없이 도구 호출을 0600 소켓으로 브리지에 넘기고, 실제 실행은 확장이 Overleaf 페이지 안에서 합니다. 도구는 프로젝트 문서를 읽고 **제안**만 만들 수 있고, 문서 변경은 사용자가 카드에서 승인할 때만 일어납니다. 세션 기록(`--session-id`/`--resume`)은 프로젝트별 0700 폴더에만 저장되고 `uninstall-host.sh`로 지워집니다.
- CLI 는 사용자 전용 0700 작업 폴더의 임시 폴더에서 별도 프로세스 그룹으로 실행되고, 취소·시간 초과 시 그룹 전체가 종료됩니다. 시스템 프롬프트는 명령 인자가 아니라 0600 파일로 전달됩니다.
- CLI 추가 인자는 확장이 보내지 않고 브리지 `config.json`(`claudeExtraArgs`, `codexExtraArgs`)에서만 읽습니다. `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 환경 변수는 기본적으로 지워 구독 로그인을 씁니다(`"keepApiKeyEnv": true`로 유지 가능).
- 확장 내부 통신은 페이지 스크립트가 볼 수 없는 비공개 채널(문서에 붙지 않은 DOM 노드의 이벤트)을 씁니다. 페이지의 `window.postMessage`로는 원고나 요청이 흐르지 않습니다.
- **Codex**: `--sandbox read-only`로 쓰기와 네트워크를 막고 빈 임시 폴더에서 실행합니다. 다만 Codex에는 도구를 완전히 끄는 옵션이 없어 읽기 전용 셸 명령은 실행될 수 있습니다. 그래서 자동완성과 문헌 기능은 Claude로만 실행합니다. 민감한 환경이면 Claude 백엔드를 권장합니다.
- 원고 내용(대상 텍스트와 주변 문맥)은 선택한 CLI를 통해 Anthropic 또는 OpenAI로 전송됩니다. 자동완성은 제안할 때마다 요청 하나(커서 앞 약 3,000자)를 보내므로, 신경 쓰이면 수동이나 끔으로 두세요.

## 문제 해결

| 증상 | 해결 |
| --- | --- |
| 점이 빨간색, "로컬 브리지에 연결할 수 없습니다" | `./scripts/install-host.sh` 실행 → `chrome://extensions`에서 확장 새로고침 |
| "forbidden" 오류 | 확장 ID가 다름 → `./scripts/install-host.sh <확장ID>` |
| "CLI 를 찾을 수 없습니다" | CLI 설치 후 설치 스크립트 다시 실행(절대 경로를 다시 기록) |
| "선택한 모델을 이 계정에서 쓸 수 없습니다" | 다른 모델을 고르거나 CLI 기본값 사용 |
| 로그인·인증 오류 | 터미널에서 `claude` / `codex`를 실행해 로그인 |
| 자동완성이 안 뜸 | 줄 끝인지, 주석·수식·프리앰블이 아닌지 확인. `Alt+\`로 직접 요청하면 안 되는 이유를 알려 줌 |
| "에디터를 찾지 못했습니다" | Overleaf의 Code Editor가 열려 있는지 확인 후 페이지 새로고침 |
| "확장 프로그램이 업데이트되었습니다" | 확장을 새로고침한 뒤에는 Overleaf 탭도 새로고침 |
| 시간 초과 | 설정에서 제한 시간을 늘리거나 사고 수준을 낮춤 |
| "로컬 브리지(vX)가 확장과 다릅니다" | `git pull` 후 `./scripts/install-host.sh` 다시 실행 → 확장 새로고침 |
| "읽기 전용 문서라 적용할 수 없습니다" | 보기 권한이거나 Overleaf 저장 오류로 잠긴 상태. 결과를 복사해 쓰거나 페이지 새로고침 |
| 에이전트 탭에서 "로컬 브리지를 업데이트해야 합니다" | 브리지가 v0.5 미만 → `./scripts/install-host.sh` 다시 실행 |
| 에이전트가 제안 없이 끝남 | 요청을 더 구체적으로(파일·절 이름). 도구 호출 40회 제한에 걸리면 그때까지의 결과로 답함 |
| 출판본·누락 인용을 못 찾음 | Semantic Scholar 요청 한도일 수 있음 → 잠시 뒤 다시, 또는 `config.json`에 `"s2ApiKey"` |

브리지 설정 파일(`~/Library/Application Support/overleaf-ai-host/config.json`, 재설치해도 유지되는 키):

```json
{
  "claudeExtraArgs": ["--fallback-model", "claude-sonnet-5-5"],
  "codexExtraArgs": [],
  "s2ApiKey": "Semantic Scholar API 키 (선택)",
  "keepApiKeyEnv": false,
  "webDomains": ["arxiv.org", "doi.org"]
}
```

호스트 단독 점검:
```bash
node -e 'const b=Buffer.from(JSON.stringify({type:"ping"}));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(Buffer.concat([h,b]))' \
  | "$HOME/Library/Application Support/overleaf-ai-host/run-host.sh" | tail -c +5; echo
```

## 개발

```
extension/
  manifest.json            MV3, overleaf.com/project/* 전용, 고정 key
  background.js            서비스 워커: Native Messaging 포트 중계, 단축키 라우팅
  content/main-world.js    CodeMirror 6 EditorView 탐색, 읽기/적용, 자동완성 고스트 텍스트
  content/content.js       패널 UI, 실행 흐름, 자동완성 트리거, 점검 화면
  content/catalog.js       모델·effort·venue·기능 카탈로그 (데이터)
  content/prompts.js       설정 기본값, 대상 결정, 프롬프트·자동완성 요청, 출력 정리
  content/lint.js          로컬 점검 규칙
  content/terms.js         용어 통일 (용어집·하이픈·영미 철자)
  content/packages.js      필요한 패키지·TikZ 라이브러리 분석, 프리앰블 삽입 위치
  content/bib.js           .bib 파서·직렬화, arXiv 판별, 인용 키 수집, 출판본 선택, BibTeX 점검
  content/bridge.js        페이지가 볼 수 없는 비공개 통신 채널(document_start)
  content/diff.js          단어 단위 diff, 변경 단위 수락/거절
  content/markdown.js      안전한 마크다운 렌더러 (L42 링크)
  content/panel-css.js     패널 스타일 (Shadow DOM)
  options.* / popup.*      설정 페이지, 툴바 팝업
host/host.js               Native Messaging 호스트 (Node 내장 모듈만 사용)
host/mcp-server.js         에이전트용 MCP stdio 서버 (도구 호출을 브리지 소켓으로 중계)
host/agent-tools.js        에이전트 도구 정의 (MCP 서버·호스트 공용)
scripts/                   install-host.sh/.ps1, uninstall-host.sh/.ps1, make-icons.py
docs/FEATURES.md           기능 분석·경쟁 솔루션 비교
tests/                     단위 테스트, 가짜 CLI 호스트 테스트, 실제 브라우저 E2E
```

```bash
npm test             # 단위 테스트 + 가짜 claude/codex·가짜 HTTP API·가짜 MCP 에이전트로 브리지 테스트 (91개)
npm install && npm run test:e2e
                     # 실제 Chrome 에 확장을 올리고 overleaf.com URL 로 CodeMirror 6 페이지를 띄워
                     # 설치된 브리지 + 실제 claude(Haiku 5.5)로 교정·후보·보고서·지시문·자동완성·
                     # 용어 통일·패키지 기입 요청·비공개 채널·BibTeX 4종·웹 문헌 검색·분량/익명화·
                     # 결과 다듬기·우클릭 경로·에이전트(도구 호출→제안→승인 적용)를 검증
                     # (E2E_WEB=0: 웹 검색 생략, E2E_ONLY_BIB=1: AI 없이 BibTeX 만, E2E_ONLY_AGENT=1: 에이전트 쪽만)
npm run package      # extension/ 을 zip 으로 묶기
```

## 제거

```bash
./scripts/uninstall-host.sh     # 브리지·매니페스트·작업 폴더(에이전트 세션 포함) 삭제 (Windows: scripts\uninstall-host.ps1)
```
그다음 `chrome://extensions`에서 확장을 삭제합니다.

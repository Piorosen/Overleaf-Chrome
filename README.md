# ✦ Overleaf AI — Claude / Codex CLI 글쓰기 확장

**overleaf.com 프로젝트 페이지에서만** 켜지는 Chrome 확장입니다. 이 컴퓨터에 설치된
**Claude Code CLI(`claude`)** 또는 **OpenAI Codex CLI(`codex`)** 로 LaTeX 원고를 쓰고 고칩니다.
API 키를 따로 넣지 않고, 각 CLI에 로그인된 구독/계정을 그대로 씁니다.

## 기능

- **선택 영역 / 현재 문단 수정**: 다듬기 · 문법 교정 · 간결하게 · 구체화 · 한→영 · 영→한 · LaTeX 수정
- **이어쓰기**: 커서 위치에서 다음 문장/문단 작성
- **직접 지시**: 원하는 요청을 입력 (선택 영역이 있으면 수정, 없으면 커서 위치에 새로 작성)
- **`% ai:` 인라인 지시문**: 원고에 `% ai: 실험 설정을 설명하는 문단 작성` 처럼 적고 실행하면 그 줄이 결과로 바뀜
- **스트리밍 미리보기 + 단어 단위 변경 표시(diff)**: 결과는 직접 고친 뒤 적용 가능. `적용(교체)`, `원문 아래에 추가`, `복사`, `다시 생성`
- **되돌리기**: 적용은 에디터 트랜잭션으로 들어가므로 `⌘/Ctrl+Z` 로 취소
- **안전한 적용**: 생성 중 공동 작업자가 문서를 고쳤으면 원문 위치를 다시 찾아 적용. 원문이 사라졌으면 적용을 막음
- 사용자 프리셋, 추가 작성 규칙(스타일 가이드), 모델/effort 선택, 다크 모드

## 구조

```
 overleaf.com 탭
 ┌──────────────────────────────────────────┐
 │ main-world.js  (페이지 MAIN world)        │  CodeMirror 6 EditorView 를 찾아
 │   ↑↓ window.postMessage                  │  문서 읽기 / 편집 적용만 담당
 │ content.js     (격리 world, Shadow DOM)   │  패널 UI · 프롬프트 생성 · diff
 └───────────────┬──────────────────────────┘
                 │ chrome.runtime.connect
         background.js (서비스 워커)
                 │ chrome.runtime.connectNative("com.olai.cli_bridge")
         host/host.js  (Node, Native Messaging 호스트)
                 │ spawn (셸 사용 안 함)
         claude -p --output-format stream-json --tools ""   또는
         codex exec --sandbox read-only -o <file> -
```

브라우저 확장은 보안상 로컬 프로그램을 직접 실행할 수 없어서, Chrome 공식 방식인
[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
호스트가 CLI를 대신 실행합니다. 요청마다 호스트 프로세스가 하나 뜨고, 패널에서 `중지`하면 CLI도 종료됩니다.

## 설치

필요한 것: macOS 또는 Linux, Node.js 18+, Chrome 계열 브라우저, 그리고 `claude` 또는 `codex` 중 하나 이상.

1. **CLI 로그인 확인**: 터미널에서 `claude` (또는 `codex`) 를 한 번 실행해 로그인되어 있는지 확인합니다.
2. **로컬 브리지 설치**
   ```bash
   ./scripts/install-host.sh
   ```
   - 호스트 파일을 `~/Library/Application Support/overleaf-ai-host/` 에 복사합니다
     (`~/Desktop` 같은 보호 폴더 밖이라서 macOS 권한 팝업이 뜨지 않습니다).
   - 로그인 셸의 `PATH` 와 `node`·`claude`·`codex` 의 절대 경로를 기록합니다.
   - 설치된 Chrome / Chromium / Brave / Edge / Vivaldi / Arc 모두에 호스트 매니페스트를 등록합니다.
3. **확장 로드**: `chrome://extensions` → 우측 상단 *개발자 모드* 켜기 → *압축해제된 확장 프로그램을 로드* → 이 저장소의 `extension/` 폴더 선택.
   - `manifest.json` 에 고정 키가 있어서 확장 ID 는 항상 `lbggnmchbhbpojfdpcfknoppbjpnmgnn` 입니다.
4. Overleaf 프로젝트를 열면 오른쪽 아래에 **✦ AI** 버튼이 보입니다. 패널 제목 옆의 점이 초록색이면 연결된 상태입니다.

> `host/host.js` 를 고쳤거나 CLI를 새로 설치·이동했다면 `./scripts/install-host.sh` 를 다시 실행하세요.

## 사용법

| 동작 | 방법 |
| --- | --- |
| 패널 열기/닫기 | `Alt+Shift+A` (mac `⌥⇧A`), 또는 ✦ AI 버튼 |
| 빠른 실행 | `Alt+Shift+I`: 커서 줄이 `% ai:` 지시문이면 실행, 아니면 선택 영역(없으면 현재 문단)에 기본 프리셋(다듬기) 실행 |
| 직접 지시 실행 | 입력칸에서 `⌘/Ctrl+Enter`. 비워 두고 실행하면 커서 줄의 `% ai:` 지시문을 실행 |
| 결과 적용 | `적용(교체)` 또는 `원문 아래에 추가` (번역 결과를 원문 밑에 둘 때 유용) |
| 되돌리기 | 에디터에서 `⌘/Ctrl+Z` |

단축키는 `chrome://extensions/shortcuts` 에서 바꿀 수 있습니다.
설정에서 **빠른 실행 결과 바로 적용**을 켜면 미리보기 없이 즉시 반영됩니다.

**작업 대상 규칙**
- 텍스트를 선택했으면: 선택 영역
- 선택이 없을 때 프리셋 버튼: 커서가 있는 문단 (빈 줄과 `\section`, `\begin` 같은 구조 명령 사이)
- 선택이 없을 때 직접 지시: 커서 위치에 새로 작성
- 커서 줄이 `% ai: ...` 이면: 그 줄 전체를 결과로 교체

## 설정 (확장 아이콘 → 설정)

- **백엔드**: Claude / Codex (패널 상단에서도 바로 전환)
- **모델**: Claude 기본값 `sonnet` (`opus`, `haiku` 또는 전체 모델 ID 가능), Codex 는 비우면 codex 기본값
- **effort**: Claude `--effort`, Codex `model_reasoning_effort` (기본 `low`, 빠른 응답용)
- **추가 작성 규칙**: 시스템 프롬프트 뒤에 붙습니다 (예: “American English, 1인칭 복수 we”)
- **사용자 프리셋**: 한 줄에 하나씩 `라벨 | 지시문`
- **문맥 길이**: 대상 앞뒤로 보낼 글자 수 (기본 3000). *파일 전체를 문맥으로 보내기* 도 가능
- **추가 인자**: CLI 에 그대로 넘길 인자 (셸 문법으로 따옴표 처리)

## 보안과 개인정보

- 확장은 `overleaf.com/project/*` 에서만 실행됩니다. 권한은 `nativeMessaging`, `storage` 두 개뿐입니다.
- 호스트 매니페스트의 `allowed_origins` 로 **이 확장만** 브리지를 쓸 수 있습니다. CLI 는 셸을 거치지 않고 인자 배열로 실행됩니다.
- 생성 요청은 패널 클릭이나 단축키처럼 **사용자가 직접 한 동작**(`isTrusted`)으로만 시작됩니다. 페이지 스크립트는 패널을 조작하거나 요청을 보낼 수 없습니다.
- **Claude**: `--tools ""` 로 모든 도구(파일·셸·웹)를 끄고, `--strict-mcp-config` 로 MCP 서버를 끄고, `--no-session-persistence` 로 세션 기록을 남기지 않습니다. 순수 텍스트 생성만 합니다.
- **Codex**: `--sandbox read-only` 로 쓰기와 네트워크를 막고 빈 임시 폴더에서 실행합니다. 다만 Codex 에는 도구를 완전히 끄는 옵션이 없어서 읽기 전용 셸 명령은 실행될 수 있습니다. 민감한 환경이면 Claude 백엔드를 권장합니다.
- 원고 내용(대상 텍스트와 주변 문맥)은 선택한 CLI 를 통해 Anthropic 또는 OpenAI 로 전송됩니다.

## 문제 해결

| 증상 | 해결 |
| --- | --- |
| 점이 빨간색, “로컬 브리지에 연결할 수 없습니다” | `./scripts/install-host.sh` 실행 → `chrome://extensions` 에서 확장 새로고침 |
| “forbidden” 오류 | 확장 ID 가 다름 → `./scripts/install-host.sh <확장ID>` |
| “CLI 를 찾을 수 없습니다” | CLI 설치 후 설치 스크립트 다시 실행 (절대 경로가 다시 기록됨) |
| 로그인/인증 오류 | 터미널에서 `claude` / `codex` 를 실행해 로그인 |
| “에디터를 찾지 못했습니다” | Overleaf 의 Code Editor 가 열려 있는지 확인 후 페이지 새로고침 |
| “확장 프로그램이 업데이트되었습니다” | 확장을 새로고침한 뒤에는 Overleaf 탭도 새로고침 |
| 시간 초과 | 설정에서 제한 시간을 늘리거나 더 빠른 모델/낮은 effort 사용 |

호스트 단독 점검:
```bash
node -e 'const b=Buffer.from(JSON.stringify({type:"ping"}));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(Buffer.concat([h,b]))' \
  | "$HOME/Library/Application Support/overleaf-ai-host/run-host.sh" | tail -c +5; echo
```

## 개발

```
extension/
  manifest.json          MV3, overleaf.com/project/* 전용, 고정 key
  background.js          서비스 워커: Native Messaging 포트 중계, 단축키 라우팅
  content/main-world.js  CodeMirror 6 EditorView 탐색 + 읽기/적용
  content/content.js     패널 UI, 실행 흐름
  content/prompts.js     설정 기본값, 프리셋, 대상 결정, 프롬프트 생성 (순수 함수)
  content/diff.js        단어 단위 diff
  content/panel-css.js   패널 스타일 (Shadow DOM)
  options.* / popup.*    설정 페이지, 툴바 팝업
host/host.js             Native Messaging 호스트 (Node 내장 모듈만 사용)
scripts/                 install-host.sh, uninstall-host.sh, make-icons.py
tests/                   단위 테스트 + 가짜 CLI 로 호스트 테스트 + 실제 브라우저 E2E
```

```bash
npm test            # prompts/diff 단위 테스트 + 가짜 claude/codex 로 호스트 프로토콜 테스트
npm install && npm run test:e2e
                    # 실제 Chrome 에 확장을 올리고, overleaf.com URL 로 CodeMirror 6 페이지를 띄워
                    # 설치된 브리지 + 실제 claude(haiku) 로 수정·지시문·되돌리기를 검증
npm run package     # extension/ 을 zip 으로 묶기
```

## 제거

```bash
./scripts/uninstall-host.sh     # 브리지와 매니페스트 삭제
```
그다음 `chrome://extensions` 에서 확장을 삭제합니다.

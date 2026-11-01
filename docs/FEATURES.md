# 논문 작성 AI 기능 분석과 설계 (v0.2)

조사일: 2026-11-01. 목표: Overleaf 에서 논문을 쓰는 연구자에게 필요한 AI 기능을 단계별로 정리하고,
기존 솔루션과 비교해 이 확장에 넣을 기능을 고른다.

## 1. 논문 작성 단계별로 필요한 기능

| 단계 | 연구자가 실제로 겪는 일 | 필요한 기능 |
| --- | --- | --- |
| 구상·초안 | 메모와 한국어 생각을 영어 문단으로 옮기기, 빈 섹션 시작하기 | 메모→문단, 한글 초안→영문, 이어쓰기, 연결 문장 |
| 문장 다듬기 | 비원어민 표현, 장황함, 학술체 부족, 과장된 주장 | 다듬기, 문법만, 학술체, 간결·명료, 나누기/합치기, 주장 완화/단정, 상투 표현 제거, 대안 표현 |
| LaTeX 작업 | 표·수식·그림·알고리즘 코드 작성, 컴파일 오류 | 자연어→표/수식/그림/알고리즘/TikZ, LaTeX 수정, 컴파일 오류 해결 |
| 참고문헌 | 인용이 필요한 문장 찾기, 실제 논문 찾기, BibTeX 정리, 존재하지 않는 인용(AI 환각) | 인용 필요 위치, 웹 검색 기반 문헌 찾기·검증, BibTeX 정리·변환 |
| 구조 점검 | 섹션 흐름, 문단마다 핵심이 하나인지 | 역개요, 논리·주장 점검, 명료성 점검 |
| 일관성 | 용어·약어·표기·철자(US/UK)·하이픈 혼용 | 로컬 일관성 검사(즉시), AI 일관성 검사 |
| 제출 직전 | 그림/표 참조 누락, TODO 잔존, 익명화, 초록 길이, 하이라이트·키워드 | 로컬 린트, 제출 전 점검, 초록·제목·기여점·하이라이트·키워드·결론·한계점 생성 |
| 리뷰 대응 | 리뷰어 코멘트별 답변, 커버레터 | 리뷰어 시뮬레이션, 리뷰 답변 작성, 커버레터 |
| 이해·검증 | 공동저자 글이나 수식 이해, 영어가 의도대로 쓰였는지 확인 | 한국어로 설명, 쉬운 요약, 수식 설명, 역번역 검증 |

## 2. 기존 솔루션 비교

| 솔루션 | 형태 | 주요 기능 | 한계 |
| --- | --- | --- | --- |
| **Overleaf AI / AI Assist** (Writefull 통합) | Overleaf 내장, 무료 일일 한도 + 유료 무제한 | AI 어시스턴트 채팅, Error Assist(컴파일 오류 설명·수정), 언어 제안, 재작성(Paraphrase·Make concise·Make scientific·Split·Join·Translate), 동의어, 제목·초록 생성, 수식·표 생성(텍스트·이미지→LaTeX), TeXGPT, Check citations(Dimensions 기반) | 모델 선택 불가, 일일 한도, 기관이 끌 수 있음, 사용자 정의 명령을 잘 모름 |
| **Writefull** | Overleaf/Word 애드인 | 언어 피드백, Paraphraser(강도 3단계), Academizer, 제목·초록 생성기, Sentence Palette(섹션별 학술 표현 600+) | 일부 위젯은 웹 전용, 문서 전체 맥락 활용 약함 |
| **Paperpal** | Word/웹 | 언어 교정, 재작성, Submission Readiness(30+ 언어·형식·기술 점검), 일관성 검사, 표절·AI 검출, AI 공개 문구 템플릿 | LaTeX/Overleaf 비중 낮음, 과학적 타당성은 보지 않음 |
| **Trinka** | 웹/Word | Consistency Check(철자 변형·하이픈·숫자 표기·대소문자), 저널 스타일 점검 | 유료 크레딧, LaTeX 비친화 |
| **OpenAI Prism** (2026-01) | 독립 LaTeX 웹 편집기(GPT-5.2) | 프로젝트 전체 맥락, arXiv 문헌 검색·삽입, Zotero 연동, 화이트보드/이미지→LaTeX, 음성 편집, Fix with AI | Overleaf가 아닌 별도 편집기로 옮겨야 함 |
| **Ageaf** (오픈소스, 2026) | Overleaf Chrome 확장 + Claude Code/Codex CLI | 에이전트 패널, 인라인 수정 수락/거절, 컴파일 로그 기반 수정, 인용 일괄 점검, 표기(약어·기호) 일관성 검사, 슬래시 명령 | 에이전트형이라 무겁고 설정이 많음 |
| **Overleaf Copilot** | Chrome 확장(ChatGPT) | 완성·개선 | 신원 권한 요구, OpenAI 전용 |
| **Thesify / CMU Paper Reviewer / Stanford Agentic Reviewer / Google Paper Assistant(STOC 2026)** | 사전 리뷰 도구 | 리뷰어 관점 피드백(강점·약점·질문) | 별도 업로드 필요, 편집기와 분리 |
| **Jenni AI** | 웹 편집기 | 자동완성, 인용 포함 생성, 요약 | 생성문이 AI 검출에 걸린다는 사용자 불만 |

## 3. 격차 분석 → 이 확장의 방향

1. **모델·사고 수준 선택**: 경쟁 제품 대부분은 모델을 고를 수 없다. Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5와 Codex 모델, effort(low~max)를 고를 수 있게 하고, **작업별 자동 effort**(가벼운 교정은 low, 생성은 medium, 검토는 high)를 기본으로 한다.
2. **Overleaf 안에서 끝내기**: Prism처럼 편집기를 옮기지 않고, Writefull·Overleaf AI 기능 대부분을 한 패널에 모은다.
3. **환각 인용 방지**: 인용 필요 위치 찾기, Claude 웹 검색으로 **실재가 확인된 문헌만** 제시, 기존 BibTeX 항목 실재 검증.
4. **무료·즉시 로컬 점검**: Trinka·Paperpal 일관성 검사와 비슷한 규칙 기반 린트를 AI 호출 없이 즉시 실행하고, 타이핑하는 동안 자동으로 다시 계산한다.
5. **변경 단위 수락/거절**: Ageaf·Writefull처럼 diff의 변경마다 개별로 받거나 버린다.
6. **논문 프로필**: 프로젝트마다 분야, 타깃 venue, 독자, US/UK 철자, 용어집을 저장해 모든 프롬프트에 넣는다(Paperpal 저널 가이드 대응).
7. **한국어 저자 특화**: 한글 초안→영문, 역번역 검증, 검토 결과는 한국어로 설명.
8. **위치 링크**: 검토 결과의 `L42` 같은 줄 번호를 누르면 에디터의 해당 줄로 이동.

## 4. v0.2 구현 기능

### 모델
- Claude: 기본값, Fable 5.1, Opus 5.5(기본), Sonnet 5.5, Haiku 5.5, 이전 세대(Fable 5, Opus 5, Sonnet 5, Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5), 사용자 지정
- Codex: 기본값(codex 설정 모델), gpt-5.5, gpt-5.4, gpt-5.4-mini, 사용자 지정
- Effort: 자동 / Claude low·medium·high·xhigh·max / Codex minimal·low·medium·high·xhigh. 모델이 지원하지 않는 단계는 숨긴다.

### 기능 카탈로그
- **교정**: 다듬기, 문법 교정, 학술체로, 간결하게, 명료하게, 문장 나누기, 문장 합치기, 흐름 개선, 주장 완화, 단정적으로, 능동태로, 상투 표현 제거, 다른 표현 3개, 단어 대안
- **작성**: 이어쓰기, 메모→문단, 구체화, 주제문 강화, 연결 문장, 제목 후보, 초록 작성, 기여점 목록, 결론 작성, 한계점 작성, 키워드, 하이라이트, 리뷰 답변 작성, 커버레터
- **LaTeX**: LaTeX 수정, 컴파일 오류 해결, 표 만들기, 수식 만들기, 그림 환경, 알고리즘, TikZ 도식, 캡션 개선, 수식 설명, BibTeX 정리, 참고문헌→BibTeX
- **문헌**(Claude + 웹 검색): 인용 필요 위치, 관련 문헌 찾기, 참고문헌 검증
- **검토**: 리뷰어 시뮬레이션, 논리·주장 점검, 용어·표기 일관성, 명료성 점검, 역개요, 제출 전 점검, 한국어로 설명, 쉬운 요약
- **번역**: 한→영, 영→한, 한글 초안→영문, 역번역 검증
- **점검**(AI 없이 즉시): 미정의/중복/미사용 라벨, 빈 인용, 환경·중괄호 짝, `~` 누락, 직선 따옴표, 반복 단어, 문장부호 뒤 인용, 하드코딩된 그림/표 번호, 캡션·라벨 누락과 순서, 미정의 약어, 철자·하이픈 혼용, 지나치게 긴 문장, 남은 TODO
- **직접 지시**: 수정·작성 모드와 질문·분석 모드, 범위(자동/선택·문단/섹션/파일 전체), 프리셋에 추가 지시를 덧붙이기
- **결과 처리**: 스트리밍, 변경 단위 수락/거절, 결과 직접 편집, 교체/아래에 추가/삽입, 후보 카드, 마크다운 보고서와 줄 링크, 주석으로 삽입, 실행 기록

## 5. 이번에 넣지 않은 것

| 기능 | 이유 |
| --- | --- |
| 여러 파일 동시 편집 | 확장은 열린 파일의 CodeMirror 문서만 안전하게 읽고 쓸 수 있다. Overleaf 내부 API를 쓰면 깨지기 쉽다 |
| 이미지→LaTeX | CLI에 이미지를 넘기려면 파일 저장과 권한 설계가 더 필요하다 |
| 표절·AI 검출 | 신뢰도가 낮고 오탐이 많아 연구자에게 위험하다 |
| 실시간 자동완성(고스트 텍스트) | CLI를 매번 띄우는 지연(1~3초)이 커서 타이핑 흐름을 방해한다 |
| Codex 웹 검색 | 문헌 기능은 도구를 WebSearch·WebFetch로만 제한할 수 있는 Claude에서만 켠다 |

## 출처
- Overleaf AI 기능 문서: https://docs.overleaf.com/integrations-and-add-ons/ai-features
- Overleaf AI 요금제 포함 공지(2026-07): https://www.overleaf.com/blog/overleaf-ai-now-a-part-of-overleaf-plans
- Writefull 위젯: https://blog.writefull.com/new-writefulls-automated-abstract-generator/ , https://blog.writefull.com/writefulls-academizer-makes-your-informal-language-academic/
- Paperpal 리뷰(제3자): https://manusights.com/blog/is-paperpal-worth-it-2026 , https://www.casrai.org/ai-writing-tools/paperpal
- Trinka Consistency Check: https://trinka.ai/features/consistency-check
- OpenAI Prism: https://infoq.com/news/2026/01/openai-prism , https://pulse2.com/openai-prism/
- Ageaf: https://github.com/onireimu/ageaf
- Overleaf Copilot 논문: https://arxiv.org/html/2403.09733v1
- 사전 리뷰 도구: https://arxiv.org/pdf/2605.20668 , https://research.google/blog/gemini-provides-automated-feedback-for-theoretical-computer-scientists-at-stoc-2026/ , https://reviewer.thesify.ai/blog/best-ai-manuscript-review-tools
- Codex 모델·effort(제3자): https://codex.danielvaughan.com/2026/03/27/reasoning-effort-tuning/ , https://www.havoptic.com/whats-new/openai-codex

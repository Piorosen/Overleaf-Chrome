// Overleaf AI — catalog of models, effort levels, venues and assistant actions. Data only.
(function (root) {
  'use strict';

  const E5 = ['low', 'medium', 'high', 'xhigh', 'max'];
  const E4 = ['low', 'medium', 'high', 'max'];

  const EFFORT_LABELS = {
    auto: '자동',
    '': 'CLI 기본값',
    none: 'none',
    minimal: 'minimal (가장 빠름)',
    low: 'low (빠름)',
    medium: 'medium',
    high: 'high (꼼꼼함)',
    xhigh: 'xhigh (매우 꼼꼼)',
    max: 'max (최대)',
  };

  // Verified against the local Claude Code CLI (2.1.x) on 2026-11-01.
  const CLAUDE_MODELS = [
    { id: '', label: 'CLI 기본값', group: '', efforts: E5 },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', note: '최고 성능 · 가장 느림', group: '최신', efforts: E5 },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', note: '고품질 · 권장', group: '최신', efforts: E5 },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: '빠름 · 균형', group: '최신', efforts: E5 },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: '가장 빠름 · 저렴', group: '최신', efforts: E5 },
    { id: 'claude-fable-5', label: 'Fable 5', group: '이전 세대', efforts: E5 },
    { id: 'claude-opus-5', label: 'Opus 5', group: '이전 세대', efforts: E5 },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', group: '이전 세대', efforts: E5 },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', group: '이전 세대', efforts: E5 },
    { id: 'claude-opus-4-7', label: 'Opus 4.7', group: '이전 세대', efforts: E5 },
    { id: 'claude-opus-4-6', label: 'Opus 4.6', group: '이전 세대', efforts: E4 },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', group: '이전 세대', efforts: E4 },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', group: '이전 세대', efforts: [] },
  ];

  // Codex model names change often; '' uses whatever ~/.codex/config.toml selects.
  const CODEX_MODELS = [
    { id: '', label: 'Codex 기본값', group: '', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.5', label: 'gpt-5.5', group: '모델', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.4', label: 'gpt-5.4', group: '모델', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', group: '모델', efforts: ['minimal', 'low', 'medium', 'high'] },
  ];

  function parseCustomModels(text) {
    return String(text || '').split('\n').map((s) => s.trim()).filter((s) => /^[\w.:\/\[\]@-]{1,100}$/.test(s));
  }

  // Model list for a backend, including user-defined IDs (one per line in settings).
  function modelsFor(backend, settings = {}) {
    const base = backend === 'codex' ? CODEX_MODELS : CLAUDE_MODELS;
    const custom = parseCustomModels(backend === 'codex' ? settings.codexCustomModels : settings.claudeCustomModels)
      .filter((id) => !base.some((m) => m.id === id))
      .map((id) => ({ id, label: id, group: '사용자 지정', efforts: backend === 'codex' ? ['minimal', 'low', 'medium', 'high', 'xhigh'] : E5 }));
    return [...base, ...custom];
  }

  function effortsFor(backend, modelId, settings) {
    const m = modelsFor(backend, settings).find((x) => x.id === modelId);
    return m ? m.efforts : (backend === 'codex' ? ['minimal', 'low', 'medium', 'high', 'xhigh'] : E5);
  }

  // Resolve 'auto' to the action's hint and clamp to what the model supports.
  function resolveEffort(backend, modelId, chosen, hint, settings) {
    const supported = effortsFor(backend, modelId, settings);
    if (!supported.length) return '';
    let e = chosen === 'auto' ? (hint || 'medium') : chosen;
    if (!e) return '';
    if (backend === 'codex' && e === 'max') e = 'xhigh';
    if (backend !== 'codex' && (e === 'minimal' || e === 'none')) e = 'low';
    if (supported.includes(e)) return e;
    if (e === 'xhigh' && supported.includes('max')) return 'high';
    return supported.includes('high') ? 'high' : supported[supported.length - 1];
  }

  const VENUES = [
    { id: '', label: '지정 안 함', guide: '' },
    { id: 'ml', label: 'ML 학회 (NeurIPS·ICML·ICLR)', guide: 'Machine-learning conference style: precise claims tied to evidence, first person plural ("we"), explicit contributions, notation defined once, no hype; respect the page limit by being concise.' },
    { id: 'acl', label: 'NLP 학회 (ACL·EMNLP)', guide: 'ACL-style NLP paper: clear task definition, explicit research questions, careful description of data and evaluation, a Limitations section is expected.' },
    { id: 'cv', label: 'CV 학회 (CVPR·ICCV·ECCV)', guide: 'Computer-vision conference style: concise, figure-driven narrative, clear method overview, quantitative comparisons with strong baselines.' },
    { id: 'ieee', label: 'IEEE 저널·학회', guide: 'IEEE style: formal and concise, numbered citations, "Fig." for figures, avoid contractions and informal phrasing.' },
    { id: 'acm', label: 'ACM', guide: 'ACM style: clear and direct, first person plural acceptable, numbered or author-year citations as the template requires.' },
    { id: 'nature', label: 'Nature 계열', guide: 'Nature-family journal style: accessible to a broad scientific audience, short sentences, minimal jargon, active voice, strong significance statement.' },
    { id: 'elsevier', label: 'Elsevier 저널', guide: 'Elsevier journal style: structured, formal, highlights and keywords expected, consistent terminology.' },
    { id: 'apa', label: 'APA (사회과학)', guide: 'APA 7 style: author-date citations, past tense for completed studies, bias-free language, precise reporting of statistics.' },
    { id: 'thesis-ko', label: '국내 학위논문·KCI', guide: 'Korean academic style when writing Korean: formal declarative endings (~이다/~하였다), technical terms with the English original in parentheses on first use.' },
  ];

  const CATEGORIES = [
    { id: 'edit', label: '교정' },
    { id: 'write', label: '작성' },
    { id: 'latex', label: 'LaTeX' },
    { id: 'refs', label: '문헌' },
    { id: 'review', label: '검토' },
    { id: 'translate', label: '번역' },
    { id: 'check', label: '점검' },
    { id: 'custom', label: '내 프리셋' },
  ];

  /*
   * kind:
   *   transform – rewrite the target (selection > scope default) in place
   *   generate  – write new text at the cursor (after the selection if any)
   *   compose   – write new text using the whole file as context; replaces the selection if any
   *   make      – LaTeX builder: converts the selection, or writes from the instruction box at the cursor
   *   variants  – return N options to pick from
   *   report    – read-only analysis shown in the panel (Markdown)
   *   fix       – compile-error assist (log + surrounding lines → explanation + patch)
   *   lint      – local rule-based checks, no AI
   * scope (default target for transform/report/variants): paragraph | section | document
   * effort: hint used when the effort picker is on "자동"
   */
  const ACTIONS = [
    // ---- 교정
    { id: 'polish', cat: 'edit', label: '다듬기', kind: 'transform', effort: 'low',
      desc: '명료성·흐름·학술적 어조를 개선',
      instruction: 'Improve clarity, flow and academic tone. Fix grammar and awkward phrasing. Keep the meaning, technical content, terminology and approximate length.' },
    { id: 'grammar', cat: 'edit', label: '문법 교정', kind: 'transform', effort: 'low',
      desc: '문법·철자·구두점만 최소 수정',
      instruction: 'Fix only grammar, spelling, punctuation, articles and clear word-choice errors. Make minimal edits; do not rephrase sentences that are already correct.' },
    { id: 'academic', cat: 'edit', label: '학술체로', kind: 'transform', effort: 'low',
      desc: '구어·비격식 표현을 학술 문체로',
      instruction: 'Rewrite informal, conversational or non-native phrasing into formal academic register (no contractions, precise verbs, objective tone). Keep the content unchanged.' },
    { id: 'concise', cat: 'edit', label: '간결하게', kind: 'transform', effort: 'low',
      desc: '중복·군더더기 제거 (약 25–35% 단축)',
      instruction: 'Make the text more concise (about 25-35% shorter) by removing redundancy, filler and wordy constructions, without losing information or technical nuance.' },
    { id: 'clarity', cat: 'edit', label: '명료하게', kind: 'transform', effort: 'low',
      desc: '한 문장 한 생각, 모호함 제거',
      instruction: 'Rewrite for maximum clarity: one idea per sentence, concrete subjects and strong verbs, fewer nominalizations, no ambiguous pronouns. Keep the meaning.' },
    { id: 'split', cat: 'edit', label: '문장 나누기', kind: 'transform', effort: 'low',
      desc: '긴 문장을 짧은 문장들로',
      instruction: 'Split long or complex sentences into shorter, well-connected sentences. Do not change the content.' },
    { id: 'join', cat: 'edit', label: '문장 합치기', kind: 'transform', effort: 'low',
      desc: '끊기는 짧은 문장을 자연스럽게 결합',
      instruction: 'Combine short, choppy sentences into fewer well-formed sentences with appropriate connectors. Do not change the content.' },
    { id: 'flow', cat: 'edit', label: '흐름 개선', kind: 'transform', effort: 'medium',
      desc: '문장 간 연결어·논리 흐름 보강',
      instruction: 'Improve cohesion and flow: logical connectors, given-to-new information order, consistent topic progression and smooth transitions between sentences. Do not add new claims.' },
    { id: 'hedge', cat: 'edit', label: '주장 완화', kind: 'transform', effort: 'low',
      desc: '근거보다 센 주장을 적절히 완화',
      instruction: 'Soften overclaims: replace absolute or unsupported statements ("proves", "always", "the first") with appropriately hedged wording ("suggests", "to our knowledge"), keeping well-supported claims direct.' },
    { id: 'assert', cat: 'edit', label: '단정적으로', kind: 'transform', effort: 'low',
      desc: '과도한 hedging·군더더기 제거',
      instruction: 'Remove excessive hedging and filler; state well-supported claims directly and confidently without overclaiming.' },
    { id: 'active', cat: 'edit', label: '능동태로', kind: 'transform', effort: 'low',
      desc: '불필요한 수동태를 능동태로',
      instruction: 'Convert unnecessary passive constructions to active voice (using "we" where appropriate for the venue). Keep passive voice where the agent is unknown or irrelevant.' },
    { id: 'deai', cat: 'edit', label: '상투 표현 제거', kind: 'transform', effort: 'low',
      desc: 'delve·pivotal 같은 부풀린 표현 정리',
      instruction: 'Remove clichéd, inflated or generic phrasing (e.g., "delve into", "pivotal", "in the realm of", "it is worth noting that", "plays a crucial role", "a testament to", "seamlessly", "groundbreaking") and unnecessary adverbs. Prefer plain, specific wording. Keep the content.' },
    { id: 'paraphrase', cat: 'edit', label: '다른 표현 3개', kind: 'variants', count: 3, effort: 'low', scope: 'paragraph',
      desc: '의미는 같고 표현이 다른 후보 3개',
      instruction: 'Write 3 alternative versions of the target text with the same meaning: (1) close to the original, (2) more concise, (3) more fluent and varied. Keep LaTeX intact.' },
    { id: 'synonyms', cat: 'edit', label: '단어 대안', kind: 'variants', count: 6, effort: 'low', needsSelection: true,
      desc: '선택한 단어·구의 대안 6개',
      instruction: 'Suggest 6 alternative words or short phrases that could replace the selected word or phrase in this exact context, ordered from closest meaning to most different. Each option must fit grammatically.' },

    // ---- 작성
    { id: 'continue', cat: 'write', label: '이어쓰기', kind: 'generate', effort: 'medium',
      desc: '커서 위치에서 다음 문장·문단 작성',
      instruction: 'Continue writing from the cursor position. If the cursor is in the middle of a paragraph, continue that paragraph; otherwise write the next paragraph (about 80-150 words). Follow the argument, notation and style of the preceding text. Do not invent citations, data or results.' },
    { id: 'bullets', cat: 'write', label: '메모→문단', kind: 'transform', effort: 'medium',
      desc: '글머리표·메모를 완성된 문단으로',
      instruction: 'Turn these notes or bullet points into well-structured academic prose (one or more paragraphs with topic sentences and transitions). Keep every point; do not add facts, numbers or citations that are not in the notes.' },
    { id: 'expand', cat: 'write', label: '구체화', kind: 'transform', effort: 'medium',
      desc: '설명·동기·연결을 보강해 확장',
      instruction: 'Expand the text with clearer explanations, motivation and smoother transitions, consistent with the surrounding context. Do not invent citations, data, numbers or results; where support is needed add a LaTeX comment line "% TODO: ...".' },
    { id: 'topic', cat: 'write', label: '주제문 강화', kind: 'transform', effort: 'low',
      desc: '문단 첫 문장을 핵심 주장으로',
      instruction: 'Rewrite the paragraph so that its first sentence is a clear topic sentence stating the main point; adjust the rest minimally for coherence.' },
    { id: 'transition', cat: 'write', label: '연결 문장', kind: 'generate', effort: 'medium',
      desc: '앞뒤 문단을 잇는 1–2문장',
      instruction: 'Write one or two transition sentences for the cursor position that connect the preceding paragraph to the following one.' },
    { id: 'title', cat: 'write', label: '제목 후보', kind: 'variants', count: 5, effort: 'medium', scope: 'document', source: 'document',
      desc: '원고 전체를 읽고 제목 5개 제안',
      instruction: 'Propose 5 candidate titles for this paper based on the full manuscript: specific, informative, at most ~15 words, no unexplained acronyms; vary the style (descriptive, result-oriented, method: application).' },
    { id: 'abstract', cat: 'write', label: '초록 작성', kind: 'compose', effort: 'high',
      desc: '원고 전체로 초록 작성 (선택 시 교체)',
      instruction: 'Write an abstract (150-250 words, one paragraph) for this paper based on the full manuscript: context and problem, gap, approach, key results (only those stated in the manuscript, with their numbers), and implications. No citations. If text is selected, it is the current abstract draft to replace.' },
    { id: 'contributions', cat: 'write', label: '기여점 목록', kind: 'compose', effort: 'medium',
      desc: 'itemize 형식의 기여점 3–4개',
      instruction: 'Write the list of main contributions of this paper as a LaTeX itemize environment with 3-4 items, each one sentence, specific and verifiable from the manuscript.' },
    { id: 'conclusion', cat: 'write', label: '결론 작성', kind: 'compose', effort: 'high',
      desc: '요약·의의·향후 연구',
      instruction: 'Write a conclusion section body (1-2 paragraphs): restate the problem and approach briefly, summarize the key findings stated in the manuscript, their significance, and concrete future work. Do not introduce new results.' },
    { id: 'limitations', cat: 'write', label: '한계점 작성', kind: 'compose', effort: 'high',
      desc: '정직한 한계점 문단',
      instruction: 'Write a candid Limitations paragraph (or short section body) based on the manuscript: assumptions, scope of evaluation, data or compute constraints, generalization, and potential negative impacts where relevant. Do not undermine claims that are supported.' },
    { id: 'keywords', cat: 'write', label: '키워드', kind: 'compose', effort: 'low',
      desc: '키워드 4–6개',
      instruction: 'Write 4-6 keywords for this paper, comma-separated, most specific first, without a trailing period.' },
    { id: 'highlights', cat: 'write', label: '하이라이트', kind: 'compose', effort: 'medium',
      desc: '저널용 핵심 요약 3–5줄',
      instruction: 'Write 3-5 research highlights as a LaTeX itemize environment; each highlight at most 85 characters including spaces, stating a concrete finding or contribution from the manuscript.' },
    { id: 'reviewer-reply', cat: 'write', label: '리뷰 답변 작성', kind: 'generate', effort: 'high', needsSelection: true,
      desc: '선택한 리뷰 코멘트에 대한 답변 초안',
      instruction: 'The selected text is a reviewer comment. Draft a polite, specific author response: thank the reviewer briefly, address the point directly, state what was changed and where (use placeholders like [Section X] or [new experiment] when unknown). Do not claim experiments or results that are not in the manuscript.' },
    { id: 'cover-letter', cat: 'write', label: '커버레터', kind: 'report', reportLang: 'en', scope: 'document', effort: 'medium',
      desc: '투고용 커버레터 초안 (영문)',
      instruction: 'Draft a concise cover letter (plain text, under 350 words) to the editor for submitting this manuscript: title, what the paper does, why it matters for the venue, key results from the manuscript, confirmation of originality, and placeholders for author names, journal and suggested reviewers.' },

    // ---- LaTeX
    { id: 'fix-latex', cat: 'latex', label: 'LaTeX 수정', kind: 'transform', effort: 'low',
      desc: '중괄호·환경·특수문자·따옴표 오류 수정',
      instruction: "Fix LaTeX errors and bad practices: unbalanced braces/environments, unescaped special characters (%, &, _, #), wrong quotes (use ``...''), missing non-breaking spaces before \\cite/\\ref (use ~). Do not change the wording of the prose." },
    { id: 'error-assist', cat: 'latex', label: '컴파일 오류 해결', kind: 'fix', effort: 'high',
      desc: 'Overleaf 로그를 읽고 원인 설명 + 수정안',
      instruction: 'Diagnose the LaTeX compile error(s) in the log and fix the source.' },
    { id: 'table', cat: 'latex', label: '표 만들기', kind: 'make', effort: 'medium',
      desc: '선택한 데이터나 설명 → booktabs 표',
      instruction: 'Create a publication-quality LaTeX table from the given data or description: table environment with \\centering, booktabs rules (\\toprule, \\midrule, \\bottomrule), a descriptive \\caption placed above the tabular, and a \\label{tab:...}. Align numbers sensibly and keep the data exactly as given.' },
    { id: 'equation', cat: 'latex', label: '수식 만들기', kind: 'make', effort: 'medium',
      desc: '말로 쓴 수식 → LaTeX',
      instruction: 'Write the described mathematics as LaTeX. Use an equation (or align) environment with a \\label{eq:...} for display math, standard notation consistent with the surrounding text, and \\mathbf/\\boldsymbol only if the document already does so.' },
    { id: 'figure', cat: 'latex', label: '그림 환경', kind: 'make', effort: 'low',
      desc: 'figure 환경 + 캡션 + 라벨',
      instruction: 'Write a LaTeX figure environment for the described figure: [t] placement, \\centering, \\includegraphics[width=\\linewidth]{figures/<name>} with a sensible placeholder file name, an informative \\caption (what is shown and what to notice) and \\label{fig:...} after the caption.' },
    { id: 'algorithm', cat: 'latex', label: '알고리즘', kind: 'make', effort: 'medium',
      desc: '의사코드 → algorithm 환경',
      instruction: 'Write the described procedure as an algorithm environment using algpseudocode (\\begin{algorithmic}[1], \\Require/\\Ensure, \\State, \\For, \\If, \\Return), with \\caption and \\label{alg:...}. Add a comment line listing the required packages.' },
    { id: 'tikz', cat: 'latex', label: 'TikZ 도식', kind: 'make', effort: 'high',
      desc: '설명 → TikZ 다이어그램',
      instruction: 'Draw the described diagram with TikZ inside a figure environment: clean node styles defined once, positioning library, arrows.meta, readable labels, \\caption and \\label. Add a comment line listing the required packages and libraries.' },
    { id: 'caption', cat: 'latex', label: '캡션 개선', kind: 'transform', effort: 'low',
      desc: '무엇을 보여주는지 명확한 캡션으로',
      instruction: 'Improve the figure/table caption: the first sentence states what is shown; then what the reader should notice (key takeaway) and necessary details (abbreviations, units, settings). Keep \\label and other commands unchanged.' },
    { id: 'explain-math', cat: 'latex', label: '수식 설명', kind: 'report', effort: 'medium', needsSelection: true,
      desc: '선택한 수식의 의미를 한국어로 설명',
      instruction: 'Explain the selected mathematics: define every symbol, what the expression computes, the intuition, typical values or edge cases, and point out any notation problems or inconsistencies with the surrounding text.' },
    { id: 'bib-clean', cat: 'latex', label: 'BibTeX 정리', kind: 'transform', effort: 'low', needsSelection: true,
      desc: 'BibTeX 항목 형식 통일·대문자 보호',
      instruction: 'Clean these BibTeX entries: consistent field order and indentation, protect capitalization in titles with braces (e.g., {BERT}, {Transformer}), "Last, First and Last, First" author format, consistent venue names, remove empty fields, fix obvious typos. Never invent DOIs, pages, volumes or venues.' },
    { id: 'ref-to-bib', cat: 'latex', label: '참고문헌→BibTeX', kind: 'transform', effort: 'medium', needsSelection: true,
      desc: '텍스트 참고문헌을 BibTeX로 변환',
      instruction: 'Convert these plain-text references into BibTeX entries with keys of the form authorYEARfirstword. Use only information present in the text; omit unknown fields rather than guessing.' },

    // ---- 문헌 (Claude + web search)
    { id: 'cite-needed', cat: 'refs', label: '인용 필요 위치', kind: 'report', effort: 'medium', scope: 'section',
      desc: '근거·인용이 필요한 문장과 검색 키워드',
      instruction: 'List the statements that need a citation (factual claims, prior work, numbers, "it is well known", comparisons). For each: the line (L<n>), the quoted claim, why it needs support, and 2-3 search keywords. Do not invent references.' },
    { id: 'find-refs', cat: 'refs', label: '관련 문헌 찾기', kind: 'report', web: true, effort: 'medium', scope: 'paragraph',
      desc: '웹 검색으로 실재 확인된 논문 + BibTeX',
      instruction: 'Use web search to find 3-6 real, relevant papers that support or relate to the target text. Only include papers you verified in search results (title, authors, year, venue, URL or DOI). For each: why it is relevant and where it could be cited (L<n>). Finish with BibTeX entries for the verified papers in a ```bibtex code block. Never fabricate a reference; say so if nothing suitable is found.' },
    { id: 'verify-refs', cat: 'refs', label: '참고문헌 검증', kind: 'report', web: true, effort: 'high', needsSelection: true,
      desc: '선택한 BibTeX/참고문헌이 실재하는지 웹으로 확인',
      instruction: 'Use web search to verify each selected reference / BibTeX entry: does the paper exist, and do title, authors, year and venue match? Output a table: key | status (verified / mismatch / not found) | corrections with source URL. Then give corrected BibTeX entries for mismatches in a ```bibtex code block.' },

    // ---- 검토
    { id: 'review', cat: 'review', label: '리뷰어 시뮬레이션', kind: 'report', effort: 'high', scope: 'document',
      desc: '심사위원 관점 강점·약점·질문·점수',
      instruction: 'Act as a rigorous but fair peer reviewer for the target venue. Output: (1) summary in 3 sentences, (2) strengths, (3) major weaknesses with line references (L<n>) and how to fix them, (4) minor issues, (5) questions for the authors, (6) overall score 1-10 and confidence 1-5 with a one-line justification. Be specific; do not praise generically.' },
    { id: 'logic', cat: 'review', label: '논리·주장 점검', kind: 'report', effort: 'high', scope: 'section',
      desc: '근거 없는 주장, 비약, 과장',
      instruction: 'Identify logical gaps, unsupported or overstated claims, circular reasoning, undefined terms or hidden assumptions, and mismatches between claims and evidence. For each: line (L<n>), quote, problem, suggested fix.' },
    { id: 'consistency', cat: 'review', label: '용어·표기 일관성', kind: 'report', effort: 'high', scope: 'document',
      desc: '용어·약어·기호·철자 혼용 (AI)',
      instruction: 'Check consistency of terminology, abbreviations (defined once, before first use, then used consistently), mathematical notation and symbols, capitalization, hyphenation, US/UK spelling, tense, and naming of figures/tables/sections. Group findings by type with line references (L<n>) and the recommended form.' },
    { id: 'clarity-check', cat: 'review', label: '명료성 점검', kind: 'report', effort: 'medium', scope: 'section',
      desc: '모호하거나 너무 긴 문장 찾기',
      instruction: 'Find sentences that are ambiguous, overly long (more than ~35 words), have unclear referents ("this", "it"), dangling modifiers or heavy nominalization. For each: line (L<n>), quote, the problem, and a rewritten version.' },
    { id: 'reverse-outline', cat: 'review', label: '역개요', kind: 'report', effort: 'medium', scope: 'document',
      desc: '문단별 핵심 한 줄 + 구조 평가',
      instruction: 'Produce a reverse outline: for each paragraph give its line range (L<a>-L<b>) and one-sentence main point. Then assess the structure: missing logical steps, redundant paragraphs, ordering problems, and paragraphs with more than one main point.' },
    { id: 'readiness', cat: 'review', label: '제출 전 점검', kind: 'report', effort: 'high', scope: 'document', withLint: true,
      desc: '투고 직전 체크리스트 (로컬 점검 포함)',
      instruction: 'Check submission readiness and output a checklist using ✅ / ⚠️ / ❌: title and abstract quality and length, contributions clearly stated, every figure/table referenced and captioned, related-work coverage, limitations stated, reproducibility details (data, code, hyperparameters, compute), ethics/funding/acknowledgment placeholders, leftover TODOs, anonymization for double-blind review (author names, self-citations, URLs, acknowledgments). Use the local lint findings provided. Give concrete fixes with line references (L<n>).' },
    { id: 'explain-ko', cat: 'review', label: '한국어로 설명', kind: 'report', effort: 'low',
      desc: '선택한 글이 무슨 말인지 설명',
      instruction: 'Explain the target text: what it says, key terms and concepts, and its role in the paper. Do not rewrite it.' },
    { id: 'lay-summary', cat: 'review', label: '쉬운 요약', kind: 'report', effort: 'low', scope: 'section',
      desc: '비전공자도 이해할 요약',
      instruction: 'Summarize the target text for a non-specialist in 3-5 short sentences, then list the 3 most important technical terms with one-line explanations.' },

    // ---- 번역
    { id: 'to-en', cat: 'translate', label: '한→영', kind: 'transform', effort: 'medium',
      desc: '자연스러운 학술 영어로 번역',
      instruction: 'Translate the text into natural, fluent academic English suitable for a research paper. Keep LaTeX commands, math, citations and labels intact.' },
    { id: 'to-ko', cat: 'translate', label: '영→한', kind: 'transform', effort: 'low',
      desc: '학술적 한국어로 번역',
      instruction: 'Translate the text into natural Korean (academic register). Keep LaTeX commands, math, citations and labels intact; give the English term in parentheses on first use of key technical terms.' },
    { id: 'ko-draft', cat: 'translate', label: '한글 초안→영문', kind: 'transform', effort: 'medium',
      desc: '거친 한국어 메모를 영어 문단으로 작성',
      instruction: 'The text is a rough Korean draft or notes. Write polished academic English prose that expresses the same content (not a literal translation): good structure, topic sentences, precise terminology. Do not add facts.' },
    { id: 'back-translate', cat: 'translate', label: '역번역 검증', kind: 'report', effort: 'low',
      desc: '영문을 직역해 의도대로 쓰였는지 확인',
      instruction: 'Translate the English target text back into Korean as literally as possible so the author can check the meaning. Then list spots where the English may convey a different meaning, nuance or strength of claim than probably intended, with suggested English fixes.' },

    // ---- 점검 (local)
    { id: 'lint', cat: 'check', label: '로컬 점검 실행', kind: 'lint',
      desc: 'AI 없이 즉시: 라벨·참조·약어·표기 혼용 등' },
  ];

  const api = {
    CLAUDE_MODELS, CODEX_MODELS, EFFORT_LABELS, VENUES, CATEGORIES, ACTIONS,
    modelsFor, effortsFor, resolveEffort, parseCustomModels,
  };
  root.OLAI_CATALOG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

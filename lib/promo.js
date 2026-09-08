// [기능 소개] 점심 메시지 등에 붙이는 "이런 일도 맡겨주세요" 예시. 매일 랜덤으로 몇 개만 보여준다.

const CAPABILITIES = [
  {
    title: '문서 초안 쓰기',
    desc: '공문·보고서·기안·복명서 초안을 「행정업무 운영 및 혁신에 관한 규정」에 맞춰 개조식(□ ○ -)으로 잡아드려요.',
    examples: [
      '다음 주 직원 안전교육 실시 계획 기안 초안 좀 잡아줘',
      '어제 다녀온 사업체 방문 복명서 써줘 (1/15 14시, ○○기업, 근무상황 점검, 직무 재배치 필요)',
    ],
  },
  {
    title: '파일 만들기',
    desc: '구글 문서·슬라이드·한글(hwpx)로 바로 만들어 드려요. 기존 파일을 복사해 내용만 채우는 것도 돼요.',
    examples: [
      '오늘 팀 회의록을 구글 문서로 만들어줘',
      '지난달 회의록 양식 그대로 복사해서 이번 달 것 만들어줘',
    ],
  },
  {
    title: '일정 관리',
    desc: '등록·삭제·알림까지 해드려요. 모든 시각은 한국 시간 기준이에요.',
    examples: [
      '다음 주 화요일 오전 10시에 팀 회의 일정 넣어줘',
      '이번 주 내 일정 뭐 있어?',
    ],
  },
  {
    title: '자료 조사',
    desc: '웹에서 최신 정보를 찾아 정리해 드려요. 기사·페이지 링크를 주면 요약도 해요.',
    examples: [
      '2026년 장애인 고용부담금 기준 좀 찾아줘',
      '다른 지자체 장애인 일자리 사업 사례 몇 개만 정리해줘',
    ],
  },
  {
    title: '아이디어 내기',
    desc: '막힐 때 같이 고민해 드려요.',
    examples: [
      '하반기 직원 워크숍 프로그램 아이디어 5개만 내줘',
    ],
  },
  {
    title: '마인드맵 만들기',
    desc: '아이디어·회의·자료를 마인드맵으로 그려 드려요(링크로 공유).',
    examples: [
      '이 회의 내용을 마인드맵으로 정리해줘',
    ],
  },
  {
    title: '투표·룰렛',
    desc: '채널에 투표나 무작위 추첨(룰렛)을 대신 올려 드려요.',
    examples: [
      '#점심 채널에 점심 메뉴 복수선택 투표 올려줘',
      '#회의 채널에 발표 순서 룰렛 돌려줘',
    ],
  },
  {
    title: '파일·이미지 읽기',
    desc: 'PDF·엑셀·워드·사진·음성 파일을 읽어 요약·정리해 드려요.',
    examples: [
      '이 PDF 내용 요약해줘',
      '회의 녹음 파일로 회의록 만들어줘',
    ],
  },
];

function pick(n) {
  const arr = CAPABILITIES.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(1, n));
}

// 랜덤 n개 기능을 슬랙용 텍스트로. 각 기능은 예시 1개만 보여 간결하게.
function format(n = 2) {
  const lines = ['💡 혹시 맡길 일 있으세요? 저에게 이렇게 시키시면 돼요 (이 대화창에 그대로 입력):', ''];
  for (const c of pick(n)) {
    lines.push(`*${c.title}* — ${c.desc}`);
    lines.push(`  예) ${c.examples[0]}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

module.exports = { format, pick, CAPABILITIES };

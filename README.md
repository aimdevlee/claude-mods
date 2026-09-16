# claude-mods

Claude Code 확장(플러그인) 모음.

## player — Apple Music 컨트롤러

터미널 안의 카세트 플레이어. Apple 공식 인터페이스만 사용합니다.

- Music.app AppleScript 사전: 재생, 정지, 스킵, 보관함 검색, 플레이리스트, 볼륨, 셔플, 반복
- iTunes Search API: Apple Music 카탈로그 검색 (API 키 불필요)

```
 ╭─────────────────────────────╮
 │ ┌─────────────────────────┐ │
 │ │ Now Playing           ▶ │ │
 │ │                         │ │
 │ │ LOVE ATTACK             │ │
 │ │ 리센느                  │ │
 │ │ SCENEDROME - EP         │ │
 │ │                         │ │
 │ │ ▮▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯ │ │
 │ │ 1:22              -1:38 │ │
 │ └─────────────────────────┘ │
 │          ╭───────╮          │
 │          │ MENU  │          │
 │      ╭───┴───────┴───╮      │
 │   ⏮  │   ╭───────╮   │  ⏭   │
 │      │   │   ●   │   │      │
 │      │   ╰───────╯   │      │
 │      ╰───┬───────┬───╯      │
 │          │  ⏯    │          │
 │          ╰───────╯          │
 ╰─────────────────────────────╯
```

### 설치

```bash
claude --plugin-dir /path/to/claude-mods
```

플러그인이 켜져 있으면 `bin/`이 PATH에 올라가서 `player` 명령을 바로 쓸 수 있고, `/player` 커맨드가 등록됩니다.

### 사용

```
/player                     밴드 열기 / 닫기
/player 밤편지               보관함 + 카탈로그를 함께 순위 매겨 재생 (없으면 Music.app에 띄움)
/player 밤편지 - 아이유        아티스트를 붙여 같은 제목의 다른 곡과 구분
/player pause | next | prev | toggle
/player volume 40
/player repeat all | shuffle on | seek 30
/player playlist Lo-Fi      재생목록 재생
/player playlists           재생목록 이름 목록
/player search feather      보관함 + 카탈로그 순위 목록 (재생은 안 함)
/player catalog feather     카탈로그 검색 결과 목록
/player compact | normal | full   밴드 크기 (아래 참고, 기본 normal)
/player close               밴드 닫기
```

CLI 직접 사용: `player help`

### 상주 플레이어

별도 터미널 탭이나 tmux 분할 창에서:

```bash
player ui
```

1초마다 화면을 갱신하며 키보드로 조작합니다. Claude Code에서 `/player next`를 실행해도 같은 화면에 즉시 반영됩니다.

| 키 | 동작 |
|---|---|
| space / enter | 재생 · 일시정지 |
| n / p (↓ / ↑) | 다음 · 이전 곡 |
| + / - | 볼륨 5씩 |
| → / ← | 10초 앞 · 뒤로 |
| s / r | 셔플 · 반복 순환 |
| / | 곡 검색 후 재생 |
| q | 종료 |

### 상태줄

`~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/claude-mods/bin/player-statusline"
  }
}
```

출력 예: `Fable  🎵 ▶ LOVE ATTACK · 리센느  ████░░░░ 1:22/3:01`

### 프롬프트 위 플레이어 밴드 (function hooks mod)

`hooks/register.tsx`는 Claude Code의 function-hooks 플러그인(공식 리포 `mods/`와 같은 방식)입니다. `/player`를 치면 프롬프트 바로 위에 밴드가 나타나고, 1초마다 Music.app을 폴링해 다시 그립니다. 버튼은 클릭 전용입니다.

왼쪽에 커버가 그려지고, 커버 높이만큼 남는 줄에 아티스트·앨범과 볼륨이 들어갑니다. 아트가 없는 곡은 같은 크기의 빈 판이 대신 들어가므로, 곡이 바뀌어도 밴드 높이와 텍스트 폭이 그대로입니다.

밴드는 세 가지 크기로 그려집니다. `/player compact`, `/player normal`, `/player full`로 바꾸며 세션 동안 유지됩니다. 커버 폭·표시 항목·미터 길이는 `hooks/register.tsx`의 `DENSITIES` 한 곳에 모여 있습니다.

| 모드 | 높이 | 커버 | 내용 |
| --- | --- | --- | --- |
| `compact` | 3줄 | 12×2 | 제목 · 아티스트, 진행 미터, 버튼 한 줄 |
| `normal` (기본) | 5줄 | 20×4 | 위 + 아티스트—앨범 줄, 셔플·볼륨 줄 |
| `full` | 10줄 | 36×7 | 위 + 장르·발매연도·수록 위치, 테두리와 `APPLE MUSIC` 헤더 |

`full`의 메타 줄은 Music.app이 실제로 알려준 것만 표시합니다. 어떤 속성이 값이 있는지는 149곡을 전수 조사해서 골랐습니다 — 로컬 `file track`은 장르·발매연도·트랙번호가 100% 채워지지만, 재생 중인 `URL track`(Apple Music 스트리밍)은 장르만 있고 나머지는 0으로 옵니다. 그래서 값이 있는 조각만 이어 붙이고, 셋 다 없으면 줄 자체가 사라집니다.

`played count`(149곡 중 3곡), `bpm`·`rating`(0곡)은 구독 곡에서 거의 채워지지 않아 아예 조회하지 않습니다.

**AppleScript로 불가능한 것**: 다음 곡 큐(Music.app 사전에 큐 용어가 없고, `index of current track`은 어떤 플레이리스트에도 없는 내부 인덱스라 신뢰 불가)와 가사(`lyrics` 속성은 있으나 149곡 전부 빈 값이고, 시간 동기화 가사는 타임코드 자체가 없음).

`normal`:

```
 ▛▜▄▞▐▙▗▟▞▄▐▛▙▗▄▟▞▐▄▛  ▶ Pop Off Pop Off          ████████░░░░░░░░ 0:16 / 2:21
 ▙▄▟▘▝▛▞▐▄▛▗▟▞▐▙▄▝▛▞▄  키키 — WhyKiiiKiii - EP
 ▐▞▛▄▙▗▝▘▟▞▐▄▛▙▗▄▟▘▝▛  shuffle                          ███████░ vol 95
 ▄▟▖▐▛▞▄▙▝▘▟▗▛▄▐▞▙▄▟▖  [⏮] [⏸] [⏭] [−] [＋] [⤨] [🔁] [✕]
```

`compact` — 아티스트가 제목 줄로 올라오고 앨범과 볼륨 줄이 빠집니다:

```
 ▛▜▄▞▐▙▗▟▞▄▐▛  ▶ Pop Off Pop Off · 키키    ████████░░░░ 0:16 / 2:21
 ▙▄▟▘▝▛▞▐▄▛▗▟  [⏮] [⏸] [⏭] [−] [＋] [⤨] [✕]
```

버튼은 모두 같은 계열의 글리프 한 칸이라 한 줄의 컨트롤 스트립으로 읽힙니다. 켜져 있는 셔플·반복은 라벨이 길어지는 대신 색으로 표시되므로, 상태가 바뀌어도 줄이 밀리지 않습니다.

커버는 Music.app AppleScript로 원본 PNG를 받아 `sips`로 40×8픽셀 BMP로 줄인 뒤, 사분 블록(`▘▝▀▖▌▞▛▗▚▐▜▄▙▟█`)으로 한 칸에 2×2 픽셀을 담습니다. 한 칸은 두 색만 쓸 수 있어 네 픽셀을 밝기로 두 무리로 나눠 밝은 쪽 평균을 글자색, 어두운 쪽 평균을 배경색으로 씁니다. 반칸 블록(`▀`)이 한 칸에 2픽셀만 담던 것에 비해 같은 화면 면적에서 픽셀이 두 배입니다. 곡이 바뀔 때만 다시 뽑고 결과를 캐시하므로 1초 폴링이 이미지를 매번 새로 만들지 않습니다.

이미지가 정사각형인데 화면에서는 가로로 눌리거나 세로로 늘어납니다. 터미널 칸 자체가 세로로 길고(실측 14.58×36px), 그 위에 렌더러가 블록 글리프를 화면 두 줄로 그리기 때문입니다. `bin/player-art`의 `CELL_ASPECT`(4.9)가 그만큼 픽셀 이미지를 가로로 넓게 뽑아 상쇄합니다. 커버가 찌그러져 보이면 이 숫자 하나만 다시 재서 고치면 됩니다.

얼리 액세스 기능이라 환경변수로 켜야 합니다 (2.1.272 기준):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/claude-mods
```

```
/player            밴드 켜기 · 끄기
/player 밤편지      검색해서 재생 (밴드도 켜짐)
/player close      밴드 끄기
```

밴드가 꺼져 있으면 프롬프트 아래 상태줄에 현재 곡 한 줄만 표시됩니다. 버튼은 마우스 클릭으로만 동작합니다 — 숫자 단축키는 입력창에 숫자를 칠 때 충돌해서 뺐습니다.

개발:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
bunx --bun tsc -p tsconfig.json
```

`.claude/types/claude-code.d.ts`는 플러그인 API 타입 선언입니다. Claude Code를 업데이트하면 세션에서 `/plugin-types`로 다시 생성하세요.

### 알려진 제한

- 밴드(function hooks) API는 얼리 액세스라 Claude Code 릴리스 간에 바뀔 수 있습니다.
- macOS 전용. 처음 실행 시 "터미널이 Music을 제어하려고 합니다" 권한 요청이 뜹니다.
- **검색은 모든 재생목록을 뒤집니다.** 보관함뿐 아니라 Apple Music 구독 재생목록("오늘의 TOP 100" 등)의 곡도 찾아 바로 재생합니다 — 이 곡들은 `shared track`이라 AppleScript로 재생됩니다.
- **어디에도 없는 곡은 자동 재생되지 않습니다.** Music.app에 곡을 띄워주고 재생은 사용자가 누릅니다 (아래 참고). 손쉬운 사용 권한은 필요 없습니다.
- `player catalog` / `player open`이 쓰는 iTunes Search API는 스토어별 ID를 돌려주고, 한국 스토어프런트(`country=KR`)는 곡 검색 결과가 비어 있습니다. 목록 조회용으로만 쓰세요. 국가는 `PLAYER_COUNTRY`로 바꿉니다 (기본 `US`).
- 앨범 아트는 Music.app이 아트워크를 들고 있는 곡에만 그려집니다.

### 보관함에 없는 곡은 왜 자동 재생되지 않나

Music.app의 AppleScript 사전은 **보관함까지만** 닿습니다. `search`는 재생목록을 받고, `add`는 로컬 파일을 받고, `play`는 보관함 항목을 받습니다. 카탈로그 검색 결과를 가리키는 명령은 없습니다.

`open location`으로 곡 페이지를 열 수는 있지만, iTunes Search API가 주는 트랙 ID는 **스토어프런트별로 다릅니다**. 미국 스토어 ID를 한국 계정으로 열면 재생할 것이 없고, 한국 스토어프런트(`country=KR`)는 Search API가 곡·앨범 결과를 아예 주지 않아 대체할 ID도 없습니다 (아티스트 검색은 됩니다).

System Events로 창을 직접 조작하면 되긴 합니다. 이전 버전이 그렇게 했습니다 — `⌘F`로 검색창에 포커스하고, 곡명을 입력하고, 첫 결과 카드를 `AXPress`로 눌렀습니다. 하지만 이 방식은 **실제 커서를 움직이고 손쉬운 사용 권한을 요구하며**, Music.app의 뷰 구조가 바뀌면 조용히 깨집니다. 음악 한 곡 틀자고 치르기엔 비싼 대가라 걷어냈습니다.

그래서 지금은 보관함에 있으면 재생하고, 없으면 Music.app에 띄워주고 멈춥니다.

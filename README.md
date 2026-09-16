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
/player                     큰 밴드 열기 / 닫기 (닫으면 compact로)
/player 밤편지               보관함 + 카탈로그를 함께 순위 매겨 재생 (없으면 Music.app에 띄움)
/player 밤편지 - 아이유        아티스트를 붙여 같은 제목의 다른 곡과 구분
/player pause | next | prev | toggle
/player volume 40
/player repeat all | shuffle on | seek 30
/player playlist Lo-Fi      재생목록 재생
/player playlists           재생목록 이름 목록
/player search feather      보관함 + 카탈로그 순위 목록 (재생은 안 함)
/player catalog feather     카탈로그 검색 결과 목록
/player compact | normal    표시 방식 (아래 참고, 기본 compact)
/player close               큰 밴드 닫기 (compact로)
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

`hooks/register.tsx`는 Claude Code의 function-hooks 플러그인(공식 리포 `mods/`와 같은 방식)입니다. 재생 중이면 프롬프트 위에 한 줄(compact)이 자동으로 뜨고, `/player`를 치면 같은 자리에 큰 밴드가 열립니다. 1초마다 Music.app을 폴링해 다시 그리며, 버튼은 클릭 전용입니다.

왼쪽에 커버가 그려지고, 커버 높이만큼 남는 줄에 아티스트·앨범과 볼륨이 들어갑니다. 아트가 없는 곡은 같은 크기의 빈 판이 대신 들어가므로, 곡이 바뀌어도 밴드 높이와 텍스트 폭이 그대로입니다.

밴드는 두 가지 크기로 그려집니다. `/player compact`와 `/player normal`로 바꾸며 세션 동안 유지됩니다. 커버 폭·표시 항목·미터 길이는 `hooks/register.tsx`의 `DENSITIES` 한 곳에 모여 있습니다.

두 모드는 같은 자리(프롬프트 위)에 그리고, 차지하는 **높이**가 다릅니다.

| 모드 | 위치 | 커버 | 내용 |
| --- | --- | --- | --- |
| `compact` (기본) | 프롬프트 위 한 줄 | 없음 | 제목 · 아티스트, 진행 미터, 전송 버튼 |
| `normal` | 프롬프트 위 밴드 (4줄) | 12×4 | 커버, 아티스트—앨범 줄, 셔플·볼륨 줄 |

`compact`가 기본이자 평상시 상태입니다. **세션을 시작할 때 음악이 재생 중이면 명령 없이도 바로 뜹니다.** 자기 자리를 따로 차지하지 않으므로 끌 이유가 없고, 그래서 밴드를 닫으면 아무것도 없는 상태가 아니라 compact로 돌아갑니다.

`/player`를 치면 큰 밴드가 열리고, 다시 치면 닫혀 compact 한 줄로 돌아옵니다. `/player compact`와 `/player normal`은 같은 것을 명시적으로 지정합니다.

둘 다 `AbovePrompt` 슬롯에 그립니다. 프롬프트 아래 푸터(`SessionMode`의 `auto mode on`, `PromptHint`의 `? for shortcuts`)는 건드리지 않습니다. Music.app이 멈추면 compact는 훅이 통과해 자리를 비웁니다.

겹쳐 보이지 않게, 트랙이 이미 화면에 그려져 있으면(compact든 열린 밴드든) 세션 상태줄에는 아무것도 내보내지 않습니다. `bin/player-statusline`(터미널 자체 상태줄)은 별개로 그대로 동작합니다.

밴드의 각 줄은 터미널 오른쪽 끝까지 늘어나지 않고 커버 옆에 모여 있습니다. 150열에 걸쳐 좌우로 밀어놓으면 제목과 시간이 한 쌍으로 안 읽히고 밴드가 흩어진 조각처럼 보이기 때문입니다.

미터는 채운 부분과 빈 부분을 다른 색으로 그립니다. 한 문자열로 묶어 dim 처리하면 두 글리프의 무게가 비슷해서 그냥 회색 덩어리가 됩니다.

`normal`:

```
 ▛▜▄▞▐▙▗▟▞▄▐▛  ▶ Pop Off Pop Off  ████████░░░░░░░░ 0:16 / 2:21
 ▙▄▟▘▝▛▞▐▄▛▗▟  키키 — WhyKiiiKiii - EP
 ▐▞▛▄▙▗▝▘▟▞▐▄  shuffle  ███████░ vol 95
 ▄▟▖▐▛▞▄▙▝▘▟▗  [⏮] [⏸] [⏭] [−] [＋] [⤨] [🔁] [✕]
```

`compact` — 같은 자리의 한 줄. 아티스트가 제목 줄로 올라오고, 볼륨·셔플·반복 버튼은 빠집니다(명령으로 조작):

```
 │ ▶ Pop Off Pop Off · 키키  █████░░░ 0:16 / 2:21  [⏮] [⏸] [⏭]
 › 여기에 입력                                      (프롬프트)
```

왼쪽 세로선은 장식이 아니라 구분자입니다. `AbovePrompt` 밴드는 포커스와 접기(`[-]`)를 위해 훅이 그린 트리를 감싸고, 그래서 위아래로 빈 줄이 한 줄씩 남습니다. 4줄짜리 `normal`은 그 여백이 묻히지만 한 줄짜리 `compact`는 그 사이에 떠 있어 트랜스크립트에 흘러나온 줄처럼 보입니다. 세로선이 그걸 플레이어의 것으로 표시합니다.

`borderStyle`로 사방을 두르면 빈 줄이 그대로 테두리 선이 되어 낭비가 없어지지만, 한 줄에는 상자가 과합니다. 한쪽 면만 두르는 `borderLeft` 류는 `BoxProps` 허용 목록에 없어서(있는 건 `borderStyle`·`borderColor`·`borderDimColor`뿐) 세로선은 테두리가 아니라 글자로 그립니다.

닫기 버튼은 없습니다 — 재생이 멈추면 compact가 알아서 자리를 비웁니다.

커버를 안 그리는 모드에서는 앨범아트를 아예 내보내지 않으므로, `compact`는 1초 폴링에 이미지 작업이 붙지 않습니다.

버튼은 모두 같은 계열의 글리프 한 칸이라 한 줄의 컨트롤 스트립으로 읽힙니다. 켜져 있는 셔플·반복은 라벨이 길어지는 대신 색으로 표시되므로, 상태가 바뀌어도 줄이 밀리지 않습니다.

커버는 Music.app AppleScript로 원본 PNG를 받아 `sips`로 24×8픽셀 BMP로 줄인 뒤, 사분 블록(`▘▝▀▖▌▞▛▗▚▐▜▄▙▟█`)으로 한 칸에 2×2 픽셀을 담습니다. 한 칸은 두 색만 쓸 수 있어 네 픽셀을 밝기로 두 무리로 나눠 밝은 쪽 평균을 글자색, 어두운 쪽 평균을 배경색으로 씁니다. 반칸 블록(`▀`)이 한 칸에 2픽셀만 담던 것에 비해 같은 화면 면적에서 픽셀이 두 배입니다. 곡이 바뀔 때만 다시 뽑고 결과를 캐시하므로 1초 폴링이 이미지를 매번 새로 만들지 않습니다.

이미지가 정사각형인데 화면에서는 가로로 눌리거나 세로로 늘어납니다. 터미널 칸 자체가 세로로 길기 때문입니다. `bin/player-art`의 `CELL_ASPECT`(2.7)가 그만큼 픽셀 이미지를 가로로 넓게 뽑아 상쇄합니다.

이 값은 터미널마다 다르고 폰트나 Ghostty의 `adjust-cell-height` 같은 설정에 따라 움직입니다. 커버가 찌그러져 보이면 커버를 스크린샷 찍어 가로÷세로를 재고, 그 비율을 현재 값에 곱해서 이 숫자 하나만 고치면 됩니다. 비율을 바꾸면 같은 폭이 만드는 행 수도 바뀌므로(`player art 12` → 4행), `DENSITIES`의 `rows`도 다시 맞춰야 합니다.

얼리 액세스 기능이라 환경변수로 켜야 합니다 (2.1.272 기준):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/claude-mods
```

버튼은 마우스 클릭으로만 동작합니다 — 숫자 단축키는 입력창에 숫자를 칠 때 충돌해서 뺐습니다.

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

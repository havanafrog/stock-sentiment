# ops — 만드는 쪽과 재는 쪽

한 세션이 만들고, 다른 세션이 잽니다. 두 세션은 컨텍스트를 공유하지 않습니다.
**공유하지 않는 것이 핵심입니다** — 같은 맥락을 가진 둘은 같은 실수를 합니다.

주고받는 것은 `ops/ledger.jsonl` 한 파일과 `SendMessage` 한 줄뿐입니다.
메시지는 컨텍스트와 함께 죽지만 장부는 남습니다.

규칙은 `.claude/skills/ops/SKILL.md` 에 있습니다.

## 두 가지로 띄울 수 있습니다

### 그냥 터미널

```
cd <저장소>
claude
```
그리고 `/ops verify`.

가장 빠릅니다. 다만 **재는 쪽이 저장소를 고칠 수 있습니다.** 스킬이 하지 말라고
적어 놨을 뿐 막지는 못합니다.

### 통(컨테이너)

```
cp ops/.env.example ops/.env      # CLAUDE_HOME 을 자기 경로로 고치세요
docker compose -f ops/docker-compose.yml run --rm verifier
```

붙으면 Claude 가 뜹니다. `/ops verify` 를 치세요.

이쪽은 **저장소가 읽기 전용으로 걸립니다.** 고치려 해도 못 고치고, 커밋도
푸시도 안 됩니다. "재는 쪽은 고치지 않는다" 가 부탁이 아니라 사실이 됩니다.
판정이 "고쳐 보니 되더라" 로 흐를 길이 막힙니다.

쓸 수 있는 곳은 셋뿐입니다.

| | | |
|---|---|---|
| `/repo` | 읽기 전용 | 저장소 |
| `/ops` | 쓰기 가능 | 장부. 호스트의 `ops/` 와 같은 파일 |
| `/scratch` | 쓰기 가능 | 서버를 띄워 보거나 복사해 부러뜨릴 자리 |
| `/tmp` | 메모리 | 나가면 사라집니다 |

## 필요한 것

- **Docker 엔진.** 윈도우면 Docker Desktop 입니다. 이 기계에는 4.88.1 을 깔았고
  WSL 2.7.12 도 같이 들어갔습니다 — Windows 11 Home 이라 WSL2 백엔드가 필수입니다.
  Hyper-V 백엔드는 Home 에 없습니다.
- `ops/.env` 의 `CLAUDE_HOME`. 통 안의 Claude 가 로그인할 자격증명 자리입니다.
- 리눅스·맥이면 `OPS_UID` / `OPS_GID` 도 `id -u` `id -g` 로 맞추세요.
  안 맞으면 장부에 못 씁니다 — 실제로 uid 1000 대 1001 로 겪었습니다.

## 걸렸던 자리

**PATH 에 docker 가 둘입니다.** winget 으로 깐 Docker CLI 가 사용자 PATH 에,
Docker Desktop 이 시스템 PATH 에 있습니다. 시스템이 먼저라 **새로 연 셸**은
Desktop 쪽을 고릅니다 — 그쪽에만 compose 플러그인이 있습니다. 이미 열려 있던
셸에서는 옛 CLI 가 잡혀 compose 가 없다고 나옵니다. 셸을 새로 여세요.

같은 이유로 자격증명 도우미를 못 찾아 빌드가 한 번 죽었습니다.

**현재 컨텍스트가 바뀌었습니다.** Docker Desktop 이 desktop-linux 를 만들고 그걸
현재로 잡습니다. 전에는 oracle 이었습니다. 오라클 배포는 ssh 로 서버에서 직접
돌리므로 영향이 없지만, 로컬에서 맨 docker 를 치면 이제 로컬 엔진을 봅니다.

## 조심할 것

`${CLAUDE_HOME}/.claude` 를 통째로 겁니다. 거기엔 **다른 프로젝트의 기록도**
들어 있습니다. 통에 그걸 다 보여 주는 셈입니다.

## 장부

```
node ops/ledger.mjs open        아직 안 끝난 주장
node ops/ledger.mjs show C1     한 건의 내력
node ops/ledger.mjs log         전부
node ops/ledger.mjs --selftest  14개
```

장부는 커밋하지 않습니다(`.gitignore`). 두 세션이 같이 쓰는 파일이라 커밋하면
충돌만 납니다.

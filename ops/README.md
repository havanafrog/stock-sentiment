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

- **Docker 엔진.** 윈도우면 Docker Desktop 입니다. 이 저장소에 있는 Docker CLI 는
  오라클 서버를 보고 있어서 로컬 통을 못 띄웁니다.
- `ops/.env` 의 `CLAUDE_HOME`. 통 안의 Claude 가 로그인할 자격증명 자리입니다.
- 리눅스·맥이면 `OPS_UID` / `OPS_GID` 도 `id -u` `id -g` 로 맞추세요.
  안 맞으면 장부에 못 씁니다 — 실제로 uid 1000 대 1001 로 겪었습니다.

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

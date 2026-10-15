# 개발 메모

플러그인 본체는 루트의 `main.js` 하나입니다. 빌드 단계 없이 그대로 Obsidian이 읽는 읽기 쉬운 JS입니다.
(v0.1.0은 TypeScript 원본 없이 압축본만 남아 있어서, v0.2.0에서 동작이 같은 읽기 쉬운 코드로 다시 썼습니다.)

## 단위 테스트

```sh
node --test dev/test/main.test.js   # 또는 npm test
```

- 의존성 설치가 필요 없습니다. (Node 20+ 내장 테스트 러너, `obsidian` 모듈은 `dev/test/obsidian-stub.js`로 대체)
- `fixtures/v0.1.0-main.js`(압축된 v0.1.0 원본)의 내부 함수와 새 `main.js`를 무작위 입력으로 대조해서,
  테두리 경로·그라데이션·설정 읽기·폴더 이름 변경 처리가 원본과 똑같은지 확인합니다.
- 그룹 묶음 규칙, 라이트/다크 색, v3 → v4 설정 이전, 그룹 편집 동작도 여기서 확인합니다.

## E2E 스모크 테스트 (실제 Obsidian, 창 없이)

Linux에서 `electron` + Obsidian `app.asar`가 있으면 됩니다. (Arch 계열 기본값: `electron43`, `/usr/lib/obsidian/app.asar`)

```sh
SOURCE_VAULT="/path/to/내 볼트" dev/e2e/setup-vault.sh   # 테스트 볼트 생성 + headless Obsidian 실행
node dev/e2e/smoke.mjs                                    # 렌더링·라이트/다크 확인, 스크린샷 저장
kill "$(cat dev/e2e/work/obsidian.pid)"                   # 종료
```

- `SOURCE_VAULT`에서 Notebook Navigator · Style Settings · Minimal 테마/설정을 **복사**해 옵니다. 원본 볼트와 내 Obsidian 설정은 건드리지 않습니다. (`--user-data-dir` 분리)
- 모든 산출물은 `dev/e2e/work/`에 생기고 git에는 올라가지 않습니다. 복사된 개인 설정도 여기 들어가니 커밋하지 마세요.
- 처음 열 때 나오는 "작성자 신뢰" 창은 스크립트가 대신 누릅니다.
- `node dev/e2e/cdp.mjs eval "<JS>"` / `node dev/e2e/cdp.mjs shot out.png [x y w h]`로 직접 조작·캡처할 수 있습니다.
- 주의: `obsidian --version`은 버전만 찍지 않고 실제 앱을 띄웁니다.

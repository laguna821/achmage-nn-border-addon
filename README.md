<img width="209" height="93" alt="Image" src="https://github.com/user-attachments/assets/43efdf67-9f7d-4315-ac0c-51a65cfeb1c7" />

<img width="210" height="215" alt="Image" src="https://github.com/user-attachments/assets/b8d10e8c-f57a-45a5-bf9f-27d6db01f08b" />

<img width="199" height="235" alt="Image" src="https://github.com/user-attachments/assets/1a514e42-0bbd-46f7-94d5-1208bc5d44af" />


<br>
<img width="418" height="457" alt="Image" src="https://github.com/user-attachments/assets/ffa4f521-c4f8-4044-a828-224127822ba9" />
<img width="168" height="148" alt="Image" src="https://github.com/user-attachments/assets/2245e679-e3b6-4677-a82f-27125dea7285" />


## 옵시디언 (Obsidian) 노트북 네비게이터 (Notebook Navigator)와 호환되는 폴더 테두리 플러그인.

참조 - 노트북 네비게이터 바로가기 <br>
https://notebooknavigator.com/ <br>
https://github.com/johansan/notebook-navigator <br>

## 이게 뭐하는 플러그인인가요?

Notebook Navigator는 기본적으로 폴더 배경색/폰트 컬러를 바꿀 수 있습니다.
그런데 테두리 만 위 사진처럼 바꾸는 기능은 없습니다.
그래서 이런 기능을 개발자에게 만들어주세요!! 라고 영어로 Issues를 올렸다가 "싫어요!"라고 까였습니다 -_-;

답답해서 제가 직접 만들었습니다!
Notebook Navigator가 버전업 되어도 별도로 갈아엎거나 충돌되지 않도록 "독립플러그인 형태이면서도 + Notebook Navigator와 호환되도록" 만들었습니다.

## 초간단 설치법
- 나의 옵시디언 볼트에서 `.obsidian - plugins` 폴더에 들어갑니다
- `achmage-nn-border-addon`이라는 이름으로 새 폴더를 만듭니다
- 폴더 안에 `main.js` `manifest.json` `styles.css` 세개의 파일을 집어넣습니다
- 끝! 간단합니다.

## 초간단 사용법

- Notebook Navigator를 사전에 옵시디언에 설치합니다
- Folder pane에서 폴더를 우클릭합니다
- Change border로 테두리 색깔을 예쁘게 집어넣습니다.
- 끝! 아주 간단해요.
- 참고: 한 가지 색깔로 냅둘 수 있지만 두 가지 색을 그래디언트 컬러로 섞을 수 있습니다! (별거 아닌데 은근 디테일에 집착하는 스타일이라..)

## v0.2.0 새 기능: 묶음(그룹) 테두리 + 라이트/다크 색 분리

폴더마다 테두리를 두르면 모든 폴더가 같은 무게로 보여서, 정보의 "묶음"이 오히려 안 보입니다.
그래서 **내가 지정한 폴더들을 한 블록으로 묶어 테두리 하나**를 그리는 기능을 넣었습니다.

- 예) `10. Data` · `20. Information` · `30. Knowledge` · `40. Meaning` → **DIKM** 블록 하나
- 예) `50. Teaching` · `70. Documentations` · `80. References` → **산출·보관** 블록 하나

그리고 모든 테두리(그룹·폴더)는 **라이트 모드 색과 다크 모드 색을 따로** 지정할 수 있습니다.
라이트 테마와 다크 테마의 컬러 콘셉트가 완전히 달라도, 테마를 바꾸면 테두리 색이 알아서 따라갑니다.
(다크 색을 비워 두면 라이트 색이 양쪽에 그대로 쓰입니다.)

### 묶음 만드는 법

- **방법 1:** 폴더 우클릭 → `Add to border group...` → `New group...` → 이름·색 지정 → Apply
- **방법 2:** 설정 → 커뮤니티 플러그인 → `Achmage Notebook Navigator Border Add-on` → `Add group`
  - 그룹 옆 📁+ 버튼으로 폴더 추가, ✕ 버튼으로 빼기, 🎨 버튼으로 이름·색 수정
- 라이트/다크 색 분리: 색 편집 창에서 `Separate dark mode colors`를 켜고 다크용 색을 넣으면 끝.

### 묶음이 그려지는 규칙

- 트리에서 **실제로 붙어 있는** 그룹 폴더끼리 테두리 하나를 씁니다. 사이에 다른 폴더가 끼면 블록이 나뉩니다.
- 숨김 처리된 폴더는 건너뛰므로, 보이는 폴더끼리 자연스럽게 붙습니다.
- 펼친 하위 폴더는 부모 폴더의 블록 안에 들어갑니다.
- 폴더 하나는 그룹 하나에만 속합니다. 다른 그룹에 넣으면 원래 그룹에서 빠집니다.
- 폴더 이름을 바꾸거나 지우면 그룹 목록도 자동으로 따라갑니다.

### 모양 조절 (Style Settings)

`Style Settings → Achmage Notebook Navigator Border Add-on → Group borders`
- 그룹 테두리 두께 / 기본 모서리 둥글기 / 기본 가로·세로 위치(블록 사이 간격)
- 폴더 테두리용 설정은 기존처럼 `Folder borders` 아래에 있습니다.
- 설정 화면의 `Show folder borders` / `Show group borders`로 각각 켜고 끌 수 있습니다. (꺼도 설정은 지워지지 않습니다.)

### 업데이트할 때 주의

- `main.js` `manifest.json` `styles.css` 세 파일만 덮어쓰세요. **`data.json`은 지우지 마세요.** (기존 폴더 테두리 설정이 들어 있습니다. v0.1 설정은 그대로 읽힙니다.)
- `main.js`는 이제 압축되지 않은 읽을 수 있는 코드라서, 직접 열어 보고 고칠 수 있습니다.
- 개발용 테스트와 E2E 스크립트는 `dev/` 폴더에 있습니다. (설치할 때는 필요 없습니다 → [dev/README.md](dev/README.md))

## Made by:
Achmage / ACH (더베러_thebetter 단톡방)

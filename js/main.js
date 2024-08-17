const HEIGHT = 4;
const WIDTH = 4;
const SHARE_MAX = 6;
// const PLAYER_NUM = 2;

let deck = null;
let share = null;
let shareCells = null;
let board = null;
let cells = null;
let selectedNumber = null;

reset();

function reset() {
    selectedNumber = null;

    document.getElementById("button_deck").textContent = "山札";
    deck = Array.from({length: 20}, (_, i) => i + 1);
    deck.sort(() => Math.random() - 0.5);

    share = document.getElementById("tr_share");
    while (share.firstChild) {
        share.removeChild(share.firstChild);
    }
    for (let i = 0; i < SHARE_MAX; i++) {
        let td = document.createElement("td");
        share.appendChild(td);
        if(document.addEventListener){
            td.addEventListener("click" , onClickShare);
        }else if(document.attachEvent){
            td.attachEvent("onclick" , onClickShare);
        }
    }

    shareCells = [];
    for (let i = 0; i < SHARE_MAX; i++) {
        shareCells.push(share.cells[i]);
    }

    board = document.getElementById("table_board1");
    while (board.firstChild) {
        board.removeChild(board.firstChild);
    }
    for (let row = 0; row < HEIGHT; row++) {
        let tr = document.createElement("tr");
        for (let col = 0; col < WIDTH; col++) {
            let td = document.createElement("td");
            
            if(document.addEventListener){
                td.addEventListener("click" , onClickBoard);
            }else if(document.attachEvent){
                td.attachEvent("onclick" , onClickBoard);
            }

            tr.appendChild(td);
        }
        board.appendChild(tr);
    }

    cells = [];
    let tdArray = document.getElementById("table_board1").getElementsByTagName("td");
    for (let row = 0; row < HEIGHT; row++) {
        cells.push([]); // 配列のそれぞれの要素を2次元配列にする
        for (let col = 0; col < WIDTH; col++) {
            cells[row].push(tdArray[row * WIDTH + col]);
        }
    }
}

function drawDeck() {
    selectedNumber = deck.pop();
    document.getElementById("button_deck").textContent = selectedNumber;
}

function onClickShare(event) {
    let x = event.target.cellIndex;

    if (selectedNumber === null && shareCells[x].textContent != "") {
        selectedNumber = shareCells[x].textContent;
        shareCells[x].textContent = "";
    } else if (selectedNumber !== null && shareCells[x].textContent == "") {
        shareCells[x].textContent = selectedNumber;
        selectedNumber = null;
    }
}

function onClickBoard(event) {
    let parentTable = event.target.closest('table');
    let x = event.target.cellIndex;
    let y = event.target.parentElement.rowIndex;

    if (selectedNumber === null) {
        return;
    }

    // TODO 上下左右の数字との大小チェック

    if (cells[y][x].textContent != "") {
        replaceNumber = cells[y][x].textContent;
        for (let i = 0; i < SHARE_MAX; i++) {
            if (shareCells[i].textContent == "") {
                shareCells[i].textContent = replaceNumber;
                break;
            }
        }
    }
    
    cells[y][x].textContent = selectedNumber;
    selectedNumber = null;
}

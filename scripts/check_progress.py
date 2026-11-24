#!/usr/bin/env python3
"""开发过程看板检查器。

只读解析 docs/开发过程.md，校验任务状态、依赖、逾期与契约变更确认情况。
退出码：0=无问题，1=有警告，2=有错误。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

VALID_STATUS = {"TODO", "DOING", "DONE", "BLOCKED", "PAUSED"}
TASK_ID_RE = re.compile(r"^[BFI]\d+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
BOARD_KEYWORDS = {
    "后端任务看板": "backend",
    "前端任务看板": "frontend",
    "联调任务看板": "integration",
}
BOARD_LABELS = {
    "backend": "后端任务",
    "frontend": "前端任务",
    "integration": "联调任务",
}


@dataclass
class Task:
    id: str
    title: str
    owner: str
    status: str
    deps: str
    updated: str
    note: str
    board: str
    line: int


@dataclass
class Report:
    boards: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    infos: list = field(default_factory=list)
    open_blockers: list = field(default_factory=list)


def split_row(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped.startswith("|"):
        return []
    cells = stripped.split("|")
    return [c.strip() for c in cells[1:-1]]


def is_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) for c in cells)


def parse_deps(raw: str) -> list[str]:
    cleaned = raw.strip().replace("`", "")
    if cleaned in {"", "-", "—", "无"}:
        return []
    parts = re.split(r"[,，、/\s]+", cleaned)
    return [p for p in parts if TASK_ID_RE.match(p)]


def parse_file(path: Path, stale_days: int) -> Report:
    report = Report()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        report.errors.append(f"无法读取文件 {path}: {exc}")
        return report

    current_section = ""
    current_board: str | None = None
    current_table: str | None = None
    tasks: list[Task] = []
    interface_rows: list[tuple[int, list[str]]] = []

    for index, line in enumerate(lines, start=1):
        if line.startswith("## "):
            current_section = line[3:].strip()
            current_board = None
            current_table = None
            for keyword, board in BOARD_KEYWORDS.items():
                if keyword in current_section:
                    current_board = board
                    break
            continue

        cells = split_row(line)
        if not cells or is_separator(cells):
            continue

        if current_board:
            if cells[0] == "ID":
                current_table = "tasks"
                continue
            if current_table == "tasks" and TASK_ID_RE.match(cells[0]):
                if len(cells) < 7:
                    report.errors.append(f"第 {index} 行：任务 {cells[0]} 列数不足（需要 7 列）")
                    continue
                task = Task(
                    id=cells[0],
                    title=cells[1],
                    owner=cells[2],
                    status=cells[3],
                    deps=cells[4],
                    updated=cells[5],
                    note=cells[6],
                    board=current_board,
                    line=index,
                )
                tasks.append(task)
            continue

        if "接口变更记录" in current_section:
            if cells[0] == "日期":
                current_table = "interface"
                continue
            if current_table == "interface" and cells and DATE_RE.match(cells[0]):
                interface_rows.append((index, cells))

    if not tasks:
        report.errors.append("未解析到任何任务，请检查看板标题或表格格式")
        return report

    # 重复 ID
    seen: dict[str, Task] = {}
    for task in tasks:
        if task.id in seen:
            report.errors.append(
                f"重复任务 ID {task.id}：第 {seen[task.id].line} 行与第 {task.line} 行"
            )
        else:
            seen[task.id] = task

    # 单任务校验
    for task in tasks:
        if task.status not in VALID_STATUS:
            report.errors.append(
                f"{task.id}（第 {task.line} 行）状态非法：'{task.status}'，"
                f"只允许 {'/'.join(sorted(VALID_STATUS))}"
            )
        if not task.owner or task.owner == "-":
            report.warnings.append(f"{task.id} 未填写负责人/工作树")
        if not DATE_RE.match(task.updated):
            report.errors.append(
                f"{task.id}（第 {task.line} 行）最近更新日期格式错误：'{task.updated}'，应为 YYYY-MM-DD"
            )
        else:
            try:
                updated = datetime.strptime(task.updated, "%Y-%m-%d").date()
            except ValueError:
                report.errors.append(f"{task.id} 最近更新日期无效：'{task.updated}'")
                continue
            if task.status == "DOING":
                age = (date.today() - updated).days
                if age > stale_days:
                    report.warnings.append(
                        f"{task.id} 处于 DOING 已 {age} 天未更新（阈值 {stale_days} 天）：{task.title}"
                    )
        if task.status == "BLOCKED":
            report.warnings.append(f"{task.id} 处于阻塞：{task.title}")

        for dep in parse_deps(task.deps):
            dep_task = seen.get(dep)
            if dep_task is None:
                report.warnings.append(f"{task.id} 依赖了不存在的任务 {dep}")
            elif task.status in {"DOING", "DONE"} and dep_task.status != "DONE":
                report.warnings.append(
                    f"{task.id} 状态为 {task.status}，但依赖 {dep} 仍为 {dep_task.status}"
                )

    # 接口变更确认
    for line_no, cells in interface_rows:
        if len(cells) < 6:
            report.errors.append(f"第 {line_no} 行：接口变更记录列数不足（需要 6 列）")
            continue
        interface, change_type, desc, backend, confirmed = cells[1], cells[2], cells[3], cells[4], cells[5]
        if "基线" in desc:
            continue
        if confirmed in {"", "-", "—"}:
            report.warnings.append(f"接口变更未确认：{interface}（{change_type}，{backend}）")

    # 阻塞表
    in_blocker = False
    for line in lines:
        if line.startswith("## "):
            in_blocker = "阻塞与待决" in line
            continue
        if not in_blocker:
            continue
        cells = split_row(line)
        if len(cells) >= 5 and DATE_RE.match(cells[0]) and cells[4] == "OPEN":
            report.open_blockers.append(f"{cells[0]} {cells[1]}（需要：{cells[3]}）")

    # 汇总
    for board in BOARD_KEYWORDS.values():
        board_tasks = [t for t in tasks if t.board == board]
        done = sum(1 for t in board_tasks if t.status == "DONE")
        doing = sum(1 for t in board_tasks if t.status == "DOING")
        todo = sum(1 for t in board_tasks if t.status == "TODO")
        blocked = sum(1 for t in board_tasks if t.status in {"BLOCKED", "PAUSED"})
        total = len(board_tasks)
        percent = round(done * 100 / total, 1) if total else 0.0
        report.boards[board] = {
            "label": BOARD_LABELS[board],
            "total": total,
            "done": done,
            "doing": doing,
            "todo": todo,
            "blocked_or_paused": blocked,
            "percent": percent,
        }

    return report


def print_text(report: Report, path: Path, stale_days: int) -> None:
    print(f"开发进度扫描：{path}")
    print(f"扫描时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}　逾期阈值：{stale_days} 天")
    print("-" * 60)

    for board in ("backend", "frontend", "integration"):
        data = report.boards.get(board)
        if not data:
            continue
        print(
            f"{data['label']}：{data['done']}/{data['total']} 完成（{data['percent']}%）"
            f"　进行中 {data['doing']}　待开始 {data['todo']}　阻塞/暂停 {data['blocked_or_paused']}"
        )

    print("-" * 60)

    if report.errors:
        print(f"错误（{len(report.errors)}）：")
        for item in report.errors:
            print(f"  [ERROR] {item}")
    else:
        print("错误：无")

    if report.warnings:
        print(f"警告（{len(report.warnings)}）：")
        for item in report.warnings:
            print(f"  [WARN] {item}")
    else:
        print("警告：无")

    if report.open_blockers:
        print(f"未解决阻塞（{len(report.open_blockers)}）：")
        for item in report.open_blockers:
            print(f"  [OPEN] {item}")

    print("-" * 60)
    if report.errors:
        print("结论：存在错误，需要修复。")
    elif report.warnings or report.open_blockers:
        print("结论：存在警告或未解决阻塞，请关注。")
    else:
        print("结论：正常。")


def main() -> int:
    parser = argparse.ArgumentParser(description="检查开发过程看板")
    parser.add_argument("--file", default="docs/开发过程.md", help="开发过程文件路径")
    parser.add_argument("--stale-days", type=int, default=3, help="DOING 逾期阈值（天）")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    path = Path(args.file)
    report = parse_file(path, args.stale_days)

    if args.json:
        payload = {
            "file": str(path),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "stale_days": args.stale_days,
            "boards": report.boards,
            "errors": report.errors,
            "warnings": report.warnings,
            "open_blockers": report.open_blockers,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_text(report, path, args.stale_days)

    if report.errors:
        return 2
    if report.warnings or report.open_blockers:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

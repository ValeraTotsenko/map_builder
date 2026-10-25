import type ExcelJS from 'exceljs';
import type { Delivery, Project, WeekBlock, WeeklyAssignment } from '../model';

export type LoadExportInput = {
  projects: Project[];
  deliveries: Delivery[];
  assignments: WeeklyAssignment[];
  blocks: WeekBlock[];
  people: { id: string; name: string }[];
  weeks: string[];
  scopeLabel: string;
};

const DAY = 86400000;
const NAVY = 'FF183153';
const BLUE = 'FF2255A4';
const PALE = 'FFEAF2FC';
const GRID = 'FFDCE5EF';

function shiftedWeek(week: string, amount: number): string {
  const day = new Date(`${week}T12:00:00Z`);
  return new Date(day.getTime() + amount * 7 * DAY).toISOString().slice(0, 10);
}

export function weeksForAllLoad(assignments: WeeklyAssignment[], blocks: WeekBlock[], fallback: string[]): string[] {
  const starts = [...assignments.map(a => a.weekStart), ...blocks.map(b => b.startWeek)].sort();
  const ends = [...assignments.map(a => a.weekStart), ...blocks.map(b => b.endWeek)].sort();
  if (!starts.length) return fallback;
  const first = starts[0];
  const last = ends.at(-1)!;
  const count = Math.round((new Date(`${last}T12:00:00Z`).getTime() - new Date(`${first}T12:00:00Z`).getTime()) / (7 * DAY)) + 1;
  return Array.from({ length: count }, (_, i) => shiftedWeek(first, i));
}

function weekLabel(week: string): string {
  const start = new Date(`${week}T12:00:00Z`);
  const end = new Date(start.getTime() + 6 * DAY);
  const monday = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 3, 12));
  const first = new Date(Date.UTC(monday.getUTCFullYear(), 0, 4, 12));
  first.setUTCDate(first.getUTCDate() + 3 - (first.getUTCDay() + 6) % 7);
  const number = 1 + Math.round((monday.getTime() - first.getTime()) / (7 * DAY));
  const dd = (date: Date) => `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `№${number} · ${dd(start)}–${dd(end)}`;
}

/** One readable worksheet: project > delivery > person, with work titles in week cells. */
export function createWeeklyLoadWorkbook(workbook: ExcelJS.Workbook, input: LoadExportInput): ExcelJS.Workbook {
  workbook.creator = 'Конструктор процессов и планов';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Загрузка по неделям', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape' },
  });
  const lastColumn = input.weeks.length + 3;
  sheet.columns = [
    { width: 26 }, { width: 27 }, { width: 23 },
    ...input.weeks.map(() => ({ width: 34 })),
  ];
  sheet.mergeCells(1, 1, 1, lastColumn);
  const title = sheet.getCell(1, 1);
  title.value = 'ПЛАН ПРОЕКТОВ · ЗАГРУЗКА ПО НЕДЕЛЯМ';
  title.font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 39;

  sheet.mergeCells(2, 1, 2, lastColumn);
  const subtitle = sheet.getCell(2, 1);
  subtitle.value = `${input.scopeLabel} · ${input.weeks.length ? `${input.weeks[0]} — ${input.weeks.at(-1)}` : 'без периода'} · Неделя: понедельник–воскресенье`;
  subtitle.font = { name: 'Aptos', size: 10, color: { argb: NAVY } };
  subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
  subtitle.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(2).height = 25;
  sheet.getRow(3).height = 10;

  const header = sheet.getRow(4);
  header.values = ['Проект', 'Поставка', 'Сотрудник', ...input.weeks.map(weekLabel)];
  header.height = 34;
  header.eachCell(cell => {
    cell.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  const personNames = new Map(input.people.map(person => [person.id, person.name]));
  const orderedProjects = [...input.projects].sort((a, b) => a.order - b.order);
  let employeeStripe = false;

  const groupRow = (column: number, label: string, project: boolean) => {
    const row = sheet.addRow([]);
    sheet.mergeCells(row.number, column, row.number, lastColumn);
    const cell = row.getCell(column);
    cell.value = label;
    cell.font = { name: 'Aptos', bold: true, size: project ? 11 : 10, color: { argb: project ? 'FFFFFFFF' : NAVY } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: project ? NAVY : PALE } };
    cell.alignment = { vertical: 'middle', indent: project ? 1 : 2 };
    row.height = project ? 29 : 25;
  };

  const workRows = (assignments: WeeklyAssignment[], blocks: WeekBlock[]) => {
    const personIds = new Set<string>();
    assignments.forEach(task => personIds.add(task.personId || ''));
    blocks.forEach(block => personIds.add(block.personId || ''));
    const sorted = [...personIds].sort((a, b) => (personNames.get(a) || 'Не назначено').localeCompare(personNames.get(b) || 'Не назначено', 'ru'));
    for (const personId of sorted) {
      const row = sheet.addRow(['', '', personNames.get(personId) || 'Не назначено']);
      row.getCell(3).font = { name: 'Aptos', size: 10, bold: true, color: { argb: NAVY } };
      let lineCount = 1;
      for (let i = 0; i < input.weeks.length; i++) {
        const week = input.weeks[i];
        const titles = [
          ...assignments.filter(task => (task.personId || '') === personId && task.weekStart === week).map(task => task.title),
          ...blocks.filter(block => (block.personId || '') === personId && block.startWeek <= week && block.endWeek >= week).map(block => `Блок: ${block.content}`),
        ];
        if (!titles.length) continue;
        row.getCell(i + 4).value = titles.join('\n');
        lineCount = Math.max(lineCount, titles.reduce((n, title) => n + Math.max(1, Math.ceil(title.length / 39)), 0));
      }
      employeeStripe = !employeeStripe;
      row.height = Math.min(360, Math.max(31, lineCount * 16 + 12));
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.alignment = { vertical: 'top', wrapText: true, indent: column === 3 ? 1 : 0 };
        cell.border = { bottom: { style: 'hair', color: { argb: GRID } } };
        if (employeeStripe) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
      });
    }
  };

  for (const project of orderedProjects) {
    groupRow(1, project.name, true);
    for (const delivery of input.deliveries.filter(item => item.projectId === project.id)) {
      groupRow(2, delivery.name, false);
      workRows(input.assignments.filter(task => task.projectId === project.id && task.deliveryId === delivery.id), input.blocks.filter(block => block.projectId === project.id && block.deliveryId === delivery.id));
    }
    const directTasks = input.assignments.filter(task => task.projectId === project.id && !task.deliveryId);
    const directBlocks = input.blocks.filter(block => block.projectId === project.id && !block.deliveryId);
    if (directTasks.length || directBlocks.length) {
      groupRow(2, 'Без поставки', false);
      workRows(directTasks, directBlocks);
    }
  }
  if (!orderedProjects.length) {
    sheet.addRow(['Нет проектов в выбранной области.']);
  }
  sheet.properties.defaultRowHeight = 25;
  return workbook;
}

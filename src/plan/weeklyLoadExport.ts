import type ExcelJS from 'exceljs';
import type { DateReference, Delivery, Project, WeekBlock, WeeklyAssignment } from '../model';

export type LoadExportInput = {
  projects: Project[];
  deliveries: Delivery[];
  assignments: WeeklyAssignment[];
  blocks: WeekBlock[];
  people: { id: string; name: string; color?: string }[];
  weeks: string[];
  scopeLabel: string;
};

const DAY = 86400000;
const TEXT = 'FF243447';
const GRID = 'FFD6DEE8';
const HEADER = 'FFF1F5FA';
const NO_PERSON = 'FFE8ECF1';
// First three colors match the employee legend in the reference workbook.
const PERSON_COLORS = ['FFFFC000', 'FFA8D08D', 'FFBDD6EE', 'FFF4B6C2', 'FFD9C5EF', 'FFB7E1DA', 'FFF7D6A3'];

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

function asExcelDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function dateText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function releaseDate(ref?: DateReference): Date | string {
  if (!ref) return '';
  if (ref.kind === 'exact') return asExcelDate(ref.date);
  if (ref.kind === 'range') return ref.text?.trim() || `${dateText(ref.start)}–${dateText(ref.end)}`;
  return ref.text?.trim() || '';
}

function personFill(color: string | undefined, index: number): string {
  if (!color || color.toLowerCase() === '#2563eb') return PERSON_COLORS[index % PERSON_COLORS.length];
  const hex = color.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return PERSON_COLORS[index % PERSON_COLORS.length];
  const channels = [0, 2, 4].map(offset => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * 0.38 + 255 * 0.62));
  return `FF${channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Release grid like the reference sheet: release fields, weekly work and a color legend. */
export function createWeeklyLoadWorkbook(workbook: ExcelJS.Workbook, input: LoadExportInput): ExcelJS.Workbook {
  workbook.creator = 'Конструктор процессов и планов';
  workbook.created = new Date();
  workbook.subject = input.scopeLabel;
  const sheet = workbook.addWorksheet('Тестирование', {
    views: [{ state: 'frozen', xSplit: 5, ySplit: 1, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape' },
  });
  sheet.columns = [{ width: 23 }, { width: 17 }, { width: 20 }, { width: 16 }, { width: 19 }, ...input.weeks.map(() => ({ width: 28 }))];
  const lastColumn = input.weeks.length + 5;
  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: GRID } }, left: { style: 'thin', color: { argb: GRID } },
    bottom: { style: 'thin', color: { argb: GRID } }, right: { style: 'thin', color: { argb: GRID } },
  };
  const header = sheet.addRow(['Проект', 'Релиз', 'Дата выхода', 'Уже в тесте', 'На тест в буд.', ...input.weeks.map(asExcelDate)]);
  header.height = 34;
  header.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = border;
  });
  for (let column = 6; column <= lastColumn; column++) header.getCell(column).numFmt = 'dd mmm';

  const personNames = new Map(input.people.map(person => [person.id, person.name]));
  const personColors = new Map(input.people.map((person, index) => [person.id, personFill(person.color, index)]));
  const personOrder = new Map(input.people.map((person, index) => [person.id, index]));
  const usedPeople = new Set<string>();

  function addRelease(project: Project, delivery: Delivery | null, assignments: WeeklyAssignment[], blocks: WeekBlock[]) {
    const ids = new Set<string>([...assignments.map(task => task.personId || ''), ...blocks.map(block => block.personId || '')]);
    const people = [...ids].sort((a, b) => (personOrder.get(a) ?? Infinity) - (personOrder.get(b) ?? Infinity) || a.localeCompare(b));
    if (!people.length) people.push('');
    const firstRow = sheet.rowCount + 1;
    for (const personId of people) {
      const row = sheet.addRow([]);
      row.height = 28;
      for (let column = 1; column <= lastColumn; column++) {
        const cell = row.getCell(column);
        cell.font = { name: 'Calibri', size: 11, color: { argb: TEXT } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = border;
      }
      let maxLines = 1;
      for (let index = 0; index < input.weeks.length; index++) {
        const week = input.weeks[index];
        const titles = [
          ...assignments.filter(task => (task.personId || '') === personId && task.weekStart === week).map(task => task.title),
          ...blocks.filter(block => (block.personId || '') === personId && block.startWeek <= week && block.endWeek >= week).map(block => block.content),
        ].filter(Boolean);
        if (!titles.length) continue;
        const cell = row.getCell(index + 6);
        cell.value = titles.join('\n');
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: personId ? personColors.get(personId) || NO_PERSON : NO_PERSON } };
        maxLines = Math.max(maxLines, titles.reduce((sum, title) => sum + Math.max(1, Math.ceil(title.length / 35)), 0));
        usedPeople.add(personId);
      }
      row.height = Math.min(220, Math.max(28, maxLines * 16 + 10));
    }
    const lastRow = sheet.rowCount;
    for (let column = 1; column <= 5; column++) {
      if (lastRow > firstRow) sheet.mergeCells(firstRow, column, lastRow, column);
      const cell = sheet.getCell(firstRow, column);
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (column <= 2) cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: TEXT } };
    }
    sheet.getCell(firstRow, 1).value = project.name;
    sheet.getCell(firstRow, 2).value = delivery?.name || (assignments.length || blocks.length ? 'Без поставки' : '');
    const dateCell = sheet.getCell(firstRow, 3);
    dateCell.value = releaseDate(delivery?.deadline);
    if (dateCell.value instanceof Date) dateCell.numFmt = 'dd.mm.yyyy';
    if (delivery?.testingTaskCount !== undefined) sheet.getCell(firstRow, 4).value = delivery.testingTaskCount;
    if (delivery?.developmentTaskCount !== undefined) sheet.getCell(firstRow, 5).value = delivery.developmentTaskCount;
  }

  for (const project of [...input.projects].sort((a, b) => a.order - b.order)) {
    const deliveries = input.deliveries.filter(item => item.projectId === project.id);
    for (const delivery of deliveries) addRelease(project, delivery,
      input.assignments.filter(task => task.projectId === project.id && task.deliveryId === delivery.id),
      input.blocks.filter(block => block.projectId === project.id && block.deliveryId === delivery.id));
    const directAssignments = input.assignments.filter(task => task.projectId === project.id && !task.deliveryId);
    const directBlocks = input.blocks.filter(block => block.projectId === project.id && !block.deliveryId);
    if (directAssignments.length || directBlocks.length || !deliveries.length) addRelease(project, null, directAssignments, directBlocks);
  }
  if (!input.projects.length) sheet.addRow(['Нет проектов в выбранной области.']);
  if (usedPeople.size) {
    sheet.addRow([]).height = 12;
    sheet.addRow(['Сотрудники']).getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: TEXT } };
    for (const personId of [...usedPeople].sort((a, b) => (personOrder.get(a) ?? Infinity) - (personOrder.get(b) ?? Infinity) || a.localeCompare(b))) {
      const cell = sheet.addRow([personNames.get(personId) || 'Не назначено']).getCell(1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: personId ? personColors.get(personId) || NO_PERSON : NO_PERSON } };
      cell.font = { name: 'Calibri', size: 11, color: { argb: TEXT } };
      cell.alignment = { vertical: 'middle' };
      cell.border = border;
    }
  }
  sheet.properties.defaultRowHeight = 28;
  return workbook;
}

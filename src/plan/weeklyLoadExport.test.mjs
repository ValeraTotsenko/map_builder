import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import ts from 'typescript';

const source = await readFile(new URL('./weeklyLoadExport.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createWeeklyLoadWorkbook, weeksForAllLoad } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

const project = (id, name, order) => ({ id, name, order });
const delivery = (id, projectId, name) => ({ id, projectId, name, deadline: { kind: 'exact', date: '2026-10-30' }, testingTaskCount: 12, developmentTaskCount: 8 });
const task = (id, projectId, deliveryId, personId, weekStart, title) => ({ id, projectId, deliveryId, personId, weekStart, title, count: 10, completedCount: 7, note: 'Приватные детали' });
const block = (id, projectId, deliveryId, personId, startWeek, endWeek, content) => ({ id, projectId, deliveryId, personId, startWeek, endWeek, content, note: 'Заметка', status: 'В работе' });

test('all-plan weeks include the complete span of blocks and assignments', () => {
  const weeks = weeksForAllLoad(
    [task('a', 'p', 'd', 'anna', '2026-10-05', 'Задача')],
    [block('b', 'p', 'd', 'anna', '2026-10-12', '2026-10-26', 'Регрессия')],
    ['2026-11-02'],
  );
  assert.deepEqual(weeks, ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(weeksForAllLoad([], [], ['2026-11-02']), ['2026-11-02']);
});

test('XLSX follows the release grid with weekly employee colors and a legend', async () => {
  const workbook = createWeeklyLoadWorkbook(new ExcelJS.Workbook(), {
    projects: [project('p2', 'Второй проект', 2), project('p1', 'Первый проект', 1)],
    deliveries: [delivery('d1', 'p1', 'Релиз 1')],
    assignments: [
      task('a1', 'p1', 'd1', 'anna', '2026-10-05', 'Подготовить кейсы'),
      task('a2', 'p1', 'd1', 'anna', '2026-10-05', 'Проверить API'),
      task('a3', 'p1', null, null, '2026-10-12', 'Разобрать дефекты'),
    ],
    blocks: [block('b1', 'p1', 'd1', 'boris', '2026-10-05', '2026-10-12', 'Регрессия')],
    people: [{ id: 'anna', name: 'Анна' }, { id: 'boris', name: 'Борис' }],
    weeks: ['2026-10-05', '2026-10-12'],
    scopeLabel: 'Весь план',
  });
  const bytes = await workbook.xlsx.writeBuffer();
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(bytes);
  assert.equal(opened.worksheets.length, 1);
  const sheet = opened.getWorksheet('Тестирование');
  assert.equal(sheet.getCell('A1').value, 'Проект');
  assert.equal(sheet.getCell('B1').value, 'Релиз');
  assert.equal(sheet.getCell('D1').value, 'Уже в тесте');
  assert.equal(sheet.getCell('E1').value, 'На тест в буд.');
  assert.ok(sheet.getCell('F1').value instanceof Date);
  const rows = [...sheet._rows].filter(Boolean);
  const firstProject = rows.find(row => row.getCell(1).value === 'Первый проект');
  const secondProject = rows.find(row => row.getCell(1).value === 'Второй проект');
  assert.ok(firstProject.number < secondProject.number);
  assert.equal(firstProject.getCell(2).value, 'Релиз 1');
  assert.equal(firstProject.getCell(4).value, 12);
  assert.equal(firstProject.getCell(5).value, 8);
  assert.ok(firstProject.getCell(3).value instanceof Date);
  assert.equal(firstProject.getCell(6).value, 'Подготовить кейсы\nПроверить API');
  assert.equal(firstProject.getCell(6).fill.fgColor.argb, 'FFFFC000');
  assert.equal(sheet.getCell(firstProject.number + 1, 6).value, 'Регрессия');
  assert.equal(sheet.getCell(firstProject.number + 1, 7).value, 'Регрессия');
  assert.equal(sheet.getCell(firstProject.number + 1, 6).fill.fgColor.argb, 'FFA8D08D');
  assert.ok(rows.some(row => row.getCell(2).value === 'Без поставки' && row.getCell(7).value === 'Разобрать дефекты'));
  assert.ok(rows.some(row => row.getCell(1).value === 'Анна' && row.getCell(1).fill.fgColor.argb === 'FFFFC000'));
  assert.ok(rows.some(row => row.getCell(1).value === 'Борис' && row.getCell(1).fill.fgColor.argb === 'FFA8D08D'));
  const allText = rows.flatMap(row => row.values).join(' ');
  assert.doesNotMatch(allText, /Приватные детали|Заметка|В работе|Выполнено|7\/10/);
});

import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('dashboard shows the team leaderboard with own row highlighted and a month toggle', async ({ page }) => {
  await login(page, 'teja');
  const board = page.getByTestId('leaderboard');
  await expect(board).toBeVisible({ timeout: 15_000 });
  await expect(board.getByRole('button', { name: 'Calls made' })).toHaveAttribute('aria-pressed', 'true');
  await expect(board.locator('li[data-me]')).toContainText('Teja');
  await board.getByRole('button', { name: 'This month' }).click();
  await expect(board.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
  await expect(board.locator('li').first()).toBeVisible();
  await board.getByRole('button', { name: 'Placements' }).click();
  await expect(board.locator('li[data-me]')).toHaveCount(0);
});

import { describe, expect, it } from 'vitest';
import { findNavItem, HOME_ITEM, NAV_ITEMS } from '@/app/nav-items';

describe('findNavItem', () => {
  it('根路径返回工作台', () => {
    expect(findNavItem('/')).toBe(HOME_ITEM);
  });

  it('精确匹配一级导航', () => {
    expect(findNavItem('/notes')?.id).toBe('notes');
    expect(findNavItem('/system')?.id).toBe('system-status');
  });

  it('子路由归属到最近的一级导航', () => {
    expect(findNavItem('/notes/new')?.id).toBe('notes');
    expect(findNavItem('/notes/0199a3f2-0001-7000-8000-000000000001')?.id).toBe('notes');
  });

  it('未知路径返回 undefined', () => {
    expect(findNavItem('/not-exists')).toBeUndefined();
  });

  it('导航项路径唯一且以 / 开头', () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((path) => path.startsWith('/'))).toBe(true);
  });
});

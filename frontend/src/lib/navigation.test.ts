// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { usePathname, useRouter } from './navigation';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });
describe('Static site navigation', () => {
  it('changes routes without reloading and notifies subscribers on back navigation', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { result } = renderHook(() => ({ path: usePathname(), router: useRouter() }));
    act(() => result.current.router.push('/employees/123?tab=documents'));
    expect(result.current.path).toBe('/employees/123');
    expect(window.location.search).toBe('?tab=documents');
    act(() => {
      window.history.replaceState(null, '', '/admin/users');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.path).toBe('/admin/users');
  });
  it('reads a deep link on first render', () => {
    window.history.replaceState(null, '', '/employees/123');
    const { result } = renderHook(() => usePathname());
    expect(result.current).toBe('/employees/123');
  });
});

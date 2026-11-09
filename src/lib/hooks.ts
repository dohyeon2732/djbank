import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { loadDashboard } from '../data/api';
import type { LoadResult } from '../data/api';

export type PageId = 'overview' | 'questions' | 'waves';

const PAGE_IDS: readonly PageId[] = ['overview', 'questions', 'waves'];

function pageFromHash(): PageId {
  const hash = window.location.hash.slice(1);
  return PAGE_IDS.find((id) => id === hash) ?? 'overview';
}

/** 탭 전환을 주소 해시에 남겨 링크로 같은 화면을 열 수 있게 합니다. */
export function useHashPage(): [PageId, (page: PageId) => void] {
  const [page, setPage] = useState<PageId>(pageFromHash);

  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const go = useCallback((next: PageId) => {
    window.history.replaceState(null, '', `#${next}`);
    setPage(next);
  }, []);

  return [page, go];
}

export function useDashboard(): LoadResult | null {
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    let active = true;
    void loadDashboard().then((loaded) => {
      if (active) setResult(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return result;
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

interface TipState {
  x: number;
  y: number;
  flip: boolean;
  content: ReactNode;
}

/** 포인터를 따라다니는 차트 툴팁. 컨테이너에 position: relative가 필요합니다. */
export function useChartTip() {
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback((event: MouseEvent, content: ReactNode) => {
    const box = (event.currentTarget as Element).closest('[data-tip-root]');
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const x = event.clientX - rect.left;
    setTip({ x, y: event.clientY - rect.top, flip: x > rect.width * 0.6, content });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  return { tip, show, hide };
}

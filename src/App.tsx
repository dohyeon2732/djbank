import { useState } from 'react';
import { QuestionDrawer } from './components/QuestionDrawer';
import { useDashboard, useHashPage } from './lib/hooks';
import type { PageId } from './lib/hooks';
import { OverviewPage } from './pages/OverviewPage';
import { QuestionsPage } from './pages/QuestionsPage';
import { RunPage } from './pages/RunPage';
import { SourcesPage } from './pages/SourcesPage';
import { WavesPage } from './pages/WavesPage';
import { EMPTY_FILTERS } from './types';

const TABS: { id: PageId; label: string }[] = [
  { id: 'overview', label: '개요' },
  { id: 'questions', label: '질문셋' },
  { id: 'waves', label: '주차별 현황' },
  { id: 'sources', label: '인용 출처' },
  { id: 'run', label: '실행' },
];

export function App() {
  const [result, reload] = useDashboard();
  const [page, go] = useHashPage();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [wave, setWave] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="masthead-title">DJ Bank GEO 관제센터</h1>
        <nav className="tabs" aria-label="페이지">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="tab"
              aria-current={page === tab.id ? 'page' : undefined}
              onClick={() => go(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {result === null ? (
        <p className="status-line" role="status">
          측정 결과를 불러오는 중입니다.
        </p>
      ) : (
        <main>
          {result.failed.length > 0 && (
            <p className="load-error" role="alert">
              {result.failed.map((file) => `${file}.json`).join(', ')} 파일을 읽지 못해 일부 수치가
              비어 있습니다. public/data 폴더에 파일이 있는지 확인한 뒤 새로고침하세요.
            </p>
          )}
          {page === 'overview' && <OverviewPage data={result.data} />}
          {page === 'questions' && (
            <QuestionsPage
              data={result.data}
              filters={filters}
              onFiltersChange={setFilters}
              onOpen={setSelectedId}
            />
          )}
          {page === 'waves' && (
            <WavesPage
              data={result.data}
              wave={wave}
              onWaveChange={setWave}
              onOpen={setSelectedId}
            />
          )}
          {page === 'sources' && <SourcesPage data={result.data} wave={wave} onWaveChange={setWave} />}
          {page === 'run' && (
            <RunPage
              onSaved={reload}
              onShowOverview={() => {
                reload();
                go('overview');
              }}
            />
          )}
          <QuestionDrawer
            data={result.data}
            questionId={selectedId}
            onClose={() => setSelectedId(null)}
          />
        </main>
      )}
    </div>
  );
}

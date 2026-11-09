import type {
  Answer,
  BrandCount,
  DashboardData,
  DataFile,
  Question,
  RawAnswer,
  Run,
  Segment,
} from '../types';

/**
 * 화면이 데이터를 가져오는 유일한 지점입니다.
 * 나중에 API 서버를 붙이면 이 파일의 fetchRows만 교체하면 됩니다.
 */
async function fetchRows<T>(file: DataFile): Promise<T[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}.json`);
  if (!response.ok) throw new Error(`${file}.json: HTTP ${response.status}`);
  return (await response.json()) as T[];
}

function parseMention(value: RawAnswer['mention']): boolean {
  return value === true || value === 'True' || value === 'true';
}

function parseBrands(value: RawAnswer['brands']): string[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function toAnswer(raw: RawAnswer): Answer {
  return { ...raw, mention: parseMention(raw.mention), brands: parseBrands(raw.brands) };
}

export interface LoadResult {
  data: DashboardData;
  failed: DataFile[];
}

/** 파일 하나가 실패해도 나머지 화면은 그대로 보여 줍니다. */
export async function loadDashboard(): Promise<LoadResult> {
  const failed: DataFile[] = [];
  const load = async <T>(file: DataFile): Promise<T[]> => {
    try {
      return await fetchRows<T>(file);
    } catch (error) {
      console.error(`load:${file}`, error);
      failed.push(file);
      return [];
    }
  };

  const [runs, segments, brands, questions, responses] = await Promise.all([
    load<Run>('runs'),
    load<Segment>('segments'),
    load<BrandCount>('brands'),
    load<Question>('questions'),
    load<RawAnswer>('responses'),
  ]);

  return { data: { runs, segments, brands, questions, answers: responses.map(toAnswer) }, failed };
}

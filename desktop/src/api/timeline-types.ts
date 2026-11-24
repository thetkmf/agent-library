/**
 * 时间轴与标签的**前端归一化类型**。
 *
 * 原始类型来自 `src/api/generated.ts`（B3 已产出 `/timeline`、`/tags`）。
 * 生成类型里 `items`、`has_more` 等字段因 OpenAPI 默认值而可选，
 * 页面与纯函数需要稳定的形状，因此在 API 层归一化后对外暴露这里的类型。
 * 字段名与契约一致，禁止在此新增契约外字段。
 */
import type { components } from './generated';

export type TimelineGroupBy = 'day' | 'week' | 'month';

/** 时间轴条目沿用 B2 的 `ItemOut`。 */
export type TimelineItem = components['schemas']['ItemOut'];

/** 契约 9.2：`{key,label,item_count,items}`，`item_count` 为本页内该分组条目数。 */
export interface TimelineGroup {
  key: string;
  label: string;
  item_count: number;
  items: TimelineItem[];
}

/** 契约 9.2：`{groups,next_cursor,has_more}`。 */
export interface TimelinePage {
  groups: TimelineGroup[];
  next_cursor: string | null;
  has_more: boolean;
}

/** 契约 9.3：`GET /tags` 列表项。 */
export type Tag = components['schemas']['TagOut'];

/** 契约 9.3：`POST /items/{item_id}/tags` 请求体。 */
export interface AttachTagsRequest {
  tag_ids: string[];
}

/**
 * F4（时间轴与标签）对外契约类型 —— 临时集中模块。
 *
 * B3 尚未合入，`src/api/generated.ts` 里还没有 `/timeline`、`/tags` 的
 * Schema。为避免组件各自手写类型，这里按《开发接口标准》9.2 / 9.3 集中
 * 定义一份；B3 合入后删除本文件，统一替换为 `generated.ts`：
 *
 * - `TimelineGroupKey` / `TimelineGroup` / `TimelinePage` ← 9.2 时间轴响应
 * - `Tag` ← 9.3 `GET /tags` 列表项（含 `item_count`）
 * - `AttachTagsRequest` ← 9.3 `POST /items/{item_id}/tags`
 *
 * 规则：字段名与枚举不得偏离契约；组件只能从这里导入，不得重复声明。
 */
import type { components } from '@/api/generated';

/** 时间轴条目沿用 B2 已生成的 `ItemOut`，不另造模型。 */
export type TimelineItem = components['schemas']['ItemOut'];

export type TimelineGroupBy = 'day' | 'week' | 'month';

/** 9.2：`{key,label,item_count,items}` */
export interface TimelineGroup {
  /** 按 tz 的日/周/月边界切分的键；跨页按 key 合并，前端不解析其格式 */
  key: string;
  /** 服务端给出的展示标签（已按 tz 本地化） */
  label: string;
  /** 当前筛选条件下该分组的条目总数（跨页稳定） */
  item_count: number;
  /** 本页内的条目（跨页时前端按 key 合并） */
  items: TimelineItem[];
}

/** 9.2：`{groups, next_cursor, has_more}` */
export interface TimelinePage {
  groups: TimelineGroup[];
  next_cursor: string | null;
  has_more: boolean;
}

/** 9.3：`GET /tags` 列表项 */
export interface Tag {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
}

/** 9.3：`POST /items/{item_id}/tags` 请求体 */
export interface AttachTagsRequest {
  tag_ids: string[];
}

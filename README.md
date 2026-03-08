# Travel Animation

保留原来的 Vite 页面 UI 和左侧地点编辑逻辑，右侧预览区改成 Remotion 驱动的地图动画。

当前动画镜头语言：

- 先聚焦起点
- 再拉远镜头
- 然后绘制航线
- 相机跟随路线头部飞向终点

## 启动网页 UI

```bash
npm install
npm run dev
```

## 打开 Remotion Studio

```bash
npm run studio
```

## 渲染视频

```bash
npm run render:journey
```

默认输出到 `out/travel-map-journey.mp4`。

## Mapbox Token

```bash
cp .env.example .env
```

把 `.env` 里的 `REMOTION_MAPBOX_TOKEN` 替换成你自己的 token。

## 关键文件

- `src/main.js`: 左侧 UI、地点输入、地理编码、排序逻辑
- `src/remotionJourneyScene.tsx`: 右侧 Remotion Player 适配层
- `src/compositions/TravelMapJourney.tsx`: 地图动画 composition
- `src/Root.tsx`: Remotion composition 注册和 render metadata

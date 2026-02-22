# TrailFrame 3D (MVP)

3D 地球旅行路线动画网站原型，技术栈：Vite + Cesium + GSAP。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## 数据配置

编辑 `src/tripData.js`：
- `city` / `country` / `flag`
- `lon` / `lat`
- `metric`
- `photos`
- `vehicle` (`plane` / `car`)

## 说明

- 地球场景与路径动画：`src/globeScene.js`
- HUD 卡片与播放控制：`src/main.js`
- 样式：`src/styles.css`

后续可扩展：
1. 增加模板编辑器（多段行程、配色、字体、图标）
2. 引入后端存储（路线 JSON、图片素材）
3. 接 Remotion/FFmpeg 导出 MP4

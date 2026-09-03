# Moon Chess · 月蚀棋 🌙

## 访问地址（纯静态单机版，分享链接）

**https://warpeas.github.io/moon-chess/**

## 玩法

- 类井字棋，横/竖/斜任意方向**三子连线胜**
- 每方最多 **3** 颗棋子；下次轮到你时，**最开始下的那颗会先消失，再落下你的新子**
- 消失预告：对方回合时，你最早下的棋子会做「渐变闪烁」提示

## 难度

- 🌙 简单：AI 偏贪婪，容易下随手棋
- ⭐ 正常：Minimax 2 层前瞻
- 💫 困难：Minimax + α-β 剪枝，5 层深度（接近最优）

## 联机对战（邀请制）

单机版分享链接只能玩 AI 对战。要启动「创房间/加入房间/双人实时对战」，请部署 Node.js 服务端：

### 推荐：Render.com 免费层一键部署

👉 **打开下面的链接即可，用 GitHub 登录，一路下一步**

https://render.com/deploy?repo=https://github.com/Warpeas/moon-chess

### Docker 自托管

```bash
docker build -t moon-chess .
docker run -p 3000:3000 moon-chess
# 然后打开 http://<你的服务器IP>:3000/
```

### Railway 一键部署

```bash
npm i -g @railway/cli && railway up
```

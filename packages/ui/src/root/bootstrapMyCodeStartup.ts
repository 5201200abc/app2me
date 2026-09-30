import "./mycodeStartup.css";
import logoUrl from "../assets/mycode-mark.png";

// HTML 中跨 Vite root 的相对 URL 会退回 index.html；交给模块图解析资源，
// 确保 React 接管前的启动图在开发服务和生产包中都指向真实图片。
for (const image of document.querySelectorAll<HTMLImageElement>(".mycode-startup__emblem img")) {
  image.src = logoUrl;
}

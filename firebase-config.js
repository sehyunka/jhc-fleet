// ─────────────────────────────────────────────────────────────
// Firebase 설정 파일
// 가이드(설치_배포_가이드.md) 4단계에서 복사한 값을 아래에 붙여넣으세요.
// 이 파일을 채우지 않으면 앱은 "기기별 저장 모드"(휴대폰에만 저장)로 동작합니다.
// ─────────────────────────────────────────────────────────────
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD3Rv3qYacgvtqT8LDNGwMdCSZK4N2rfjk",
  authDomain: "jhc-fleet.firebaseapp.com",
  projectId: "jhc-fleet",
  storageBucket: "jhc-fleet.firebasestorage.app",
  messagingSenderId: "750784794465",
  appId: "1:750784794465:web:f543a8eb79e669ced37f20"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
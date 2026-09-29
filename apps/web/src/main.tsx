import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./app/store";
import { injectStore } from "./api/apiClient";

import App from "./App";
import { ThemeProvider } from "./providers/ThemeProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import ThemedToastContainer from "./components/common/ThemedToastContainer";

// Custom CSS
import "./assets/css/style.css";
import "./assets/css/responsive.css";

// Toastify
import "react-toastify/dist/ReactToastify.css";

// Inject store to avoid circular dependency in axios client
injectStore(store);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <I18nProvider>
        <ThemeProvider>
          <BrowserRouter>
            <App />

            <ThemedToastContainer />
          </BrowserRouter>
        </ThemeProvider>
      </I18nProvider>
    </Provider>
  </React.StrictMode>
);

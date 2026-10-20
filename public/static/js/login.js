// Login page script: fetch-based submission so the CSRF custom header can be
// attached. All user-facing messages are Persian.

(function () {
  "use strict";

  const form = document.getElementById("login-form");
  const passwordInput = document.getElementById("password");
  const errorBox = document.getElementById("login-error");

  if (!form || !passwordInput || !errorBox) return;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const password = passwordInput.value;
    if (!password) {
      showError("لطفاً رمز عبور را وارد کنید.");
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    errorBox.hidden = true;

    fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
      },
      body: JSON.stringify({ password: password }),
    })
      .then(function (response) {
        if (response.ok) {
          window.location.replace("/admin");
          return;
        }
        return response
          .json()
          .then(function (data) {
            showError(data && data.error ? data.error : "ورود ناموفق بود.");
          })
          .catch(function () {
            showError("ورود ناموفق بود.");
          });
      })
      .catch(function () {
        showError("خطا در ارتباط با سرور.");
      })
      .finally(function () {
        submitButton.disabled = false;
      });
  });
})();

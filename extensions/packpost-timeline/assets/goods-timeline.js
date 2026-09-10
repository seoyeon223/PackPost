(function () {
  "use strict";

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return iso;
    }
  }

  function renderSteps(container, data) {
    var stages = data.stages || [];
    var currentIndex = stages.findIndex(function (s) {
      return s.key === data.currentStage;
    });

    var stepsHtml = stages
      .map(function (stage, i) {
        var status =
          i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          '<li class="goods-timeline__step goods-timeline__step--' +
          status +
          '">' +
          '<span class="goods-timeline__dot" aria-hidden="true"></span>' +
          '<span class="goods-timeline__label">' +
          escapeHtml(stage.label) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    var stepsEl = container.querySelector(".goods-timeline__steps");
    stepsEl.innerHTML = stepsHtml;

    var updates = (data.updates || []).slice().reverse();
    var historyHtml = updates
      .map(function (u) {
        var stage = stages.find(function (s) {
          return s.key === u.stageKey;
        });
        var label = stage ? stage.label : u.stageKey;
        var note = u.note
          ? '<p class="goods-timeline__note">' + escapeHtml(u.note) + "</p>"
          : "";
        return (
          '<li class="goods-timeline__history-item">' +
          '<span class="goods-timeline__history-date">' +
          formatDate(u.at) +
          "</span>" +
          '<span class="goods-timeline__history-label">' +
          escapeHtml(label) +
          "</span>" +
          note +
          "</li>"
        );
      })
      .join("");

    var historyEl = container.querySelector(".goods-timeline__history");
    if (historyEl) {
      historyEl.innerHTML = historyHtml;
    }
  }

  function init(root) {
    var form = root.querySelector(".goods-timeline__form");
    var resultEl = root.querySelector(".goods-timeline__result");
    var errorEl = root.querySelector(".goods-timeline__error");
    var proxyPath = root.getAttribute("data-proxy-path");
    if (!form || !proxyPath) return;

    // History log list isn't in the base markup; add it lazily on first render.
    if (resultEl && !resultEl.querySelector(".goods-timeline__history")) {
      var historyWrap = document.createElement("div");
      historyWrap.innerHTML =
        '<h4 class="goods-timeline__history-heading">업데이트 내역</h4>' +
        '<ul class="goods-timeline__history"></ul>';
      resultEl.appendChild(historyWrap);
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var order = form.elements.namedItem("order").value.trim();
      var email = form.elements.namedItem("email").value.trim();
      if (!order || !email) return;

      var submitButton = form.querySelector("button[type=submit]");
      var originalLabel = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "조회 중...";
      errorEl.hidden = true;
      resultEl.hidden = true;

      var url =
        proxyPath +
        "?order=" +
        encodeURIComponent(order) +
        "&email=" +
        encodeURIComponent(email);

      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("not_found");
          return res.json();
        })
        .then(function (data) {
          renderSteps(root, data);
          resultEl.hidden = false;
        })
        .catch(function () {
          errorEl.textContent =
            "주문 정보를 찾을 수 없습니다. 주문번호와 이메일을 다시 확인해 주세요.";
          errorEl.hidden = false;
        })
        .finally(function () {
          submitButton.disabled = false;
          submitButton.textContent = originalLabel;
        });
    });
  }

  document.querySelectorAll(".goods-timeline").forEach(init);
})();

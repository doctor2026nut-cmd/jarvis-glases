/**
 * tools.js — Спецификации и локальные хэндлеры инструментов для ассистента Jarvis (T05).
 * Соответствует спецификации Tool Declarations для Gemini Live API / Function Calling.
 */

export const jarvisTools = [
  {
    name: "get_system_status",
    description: "Получить текущий статус системы, устройства (очков/смартфона), сети и батареи.",
    parameters: {
      type: "OBJECT",
      properties: {},
      required: []
    }
  },
  {
    name: "get_active_tasks",
    description: "Получить список активных или запланированных задач ассистента.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: {
          type: "STRING",
          description: "Фильтр задач: 'all', 'pending', 'in_progress', 'completed'",
          enum: ["all", "pending", "in_progress", "completed"]
        }
      },
      required: []
    }
  },
  {
    name: "query_iclub_knowledge",
    description: "Поиск информации в базе знаний I CLUB (международный рекрутинг, кандидаты, регламенты, CRM).",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Вопрос или поисковый запрос по базе знаний"
        }
      },
      required: ["query"]
    }
  }
];

/**
 * Локальные обработчики вызовов инструментов (T05).
 */
export async function executeTool(name, args = {}) {
  console.log(`[tools] Вызов инструмента: ${name}`, args);

  switch (name) {
    case "get_system_status": {
      let batteryInfo = "неизвестно";
      if (navigator.getBattery) {
        try {
          const b = await navigator.getBattery();
          batteryInfo = `${Math.round(b.level * 100)}% (${b.charging ? "заряжается" : "от батареи"})`;
        } catch (_) {}
      }

      return {
        timestamp: new Date().toISOString(),
        online: navigator.onLine,
        battery: batteryInfo,
        userAgent: navigator.userAgent,
        platform: "AI Glasses Web Client",
        status: "active"
      };
    }

    case "get_active_tasks": {
      return {
        tasks: [
          { id: "T01", title: "Веб-клиент Jarvis", status: "review", priority: "high" },
          { id: "T02", title: "Сервер-прокси", status: "pending", assignee: "Muse" },
          { id: "T04", title: "База знаний I CLUB", status: "in_progress", assignee: "Antigravity" },
          { id: "T05", title: "Инструменты чтения статусов", status: "ready", assignee: "Antigravity" }
        ]
      };
    }

    case "query_iclub_knowledge": {
      return {
        note: "Данные передаются из локального модуля базы знаний I CLUB (T04)",
        query: args.query,
        context: "I CLUB: международный рекрутинг, найм линейного персонала в Европе, CRM кандидатов и автоквалификация."
      };
    }

    default:
      return { error: `Неизвестный инструмент: ${name}` };
  }
}

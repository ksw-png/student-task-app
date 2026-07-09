import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import supabase from "./supabaseClient";

function getKSTInfo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());

  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  });

  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
  };
}

function getJobDescription(job) {
  if (!job) return "";

  const candidates = [
    job.description,
    job.detail,
    job.content,
    job.manual,
    job.manual_content,
    job.guide,
    job.job_description,
  ];

  const found = candidates.find(
    (value) => typeof value === "string" && value.trim() !== ""
  );

  return found || "";
}

function normalizeJob(job) {
  if (!job) return null;

  return {
    ...job,
    resolvedDescription: getJobDescription(job),
    resolvedManualTitle:
      job.manual_title ||
      job.guide_title ||
      job.description_title ||
      "직업 설명서",
  };
}

function getTaskPoint(task) {
  return Number(task?.point_value ?? task?.reward_points ?? task?.points ?? 0);
}

function buildTodayTaskRows(jobTasks, dailyChecks) {
  const checkMap = new Map((dailyChecks || []).map((row) => [row.job_task_id, row]));

  return (jobTasks || [])
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .slice(0, 5)
    .map((task) => {
      const check = checkMap.get(task.id);

      return {
        id: task.id,
        title: task.title || task.task_name || task.name || "할 일",
        description: task.description || task.detail || task.content || "",
        point_value: getTaskPoint(task),
        sort_order: task.sort_order || 0,
        daily_check_id: check?.id ?? null,
        checked: check?.checked ?? false,
        checked_at: check?.checked_at ?? null,
        rewarded: check?.rewarded ?? false,
        rewarded_at: check?.rewarded_at ?? null,
      };
    });
}

function getTransactionLabel(tx) {
  switch (tx?.transaction_type) {
    case "reward":
      return "포인트 지급";
    case "transfer_out":
      return "송금 보냄";
    case "transfer_in":
      return "송금 받음";
    default:
      return "거래";
  }
}

function getTransactionAmount(tx) {
  return Number(tx?.amount ?? tx?.point_amount ?? tx?.points ?? tx?.delta ?? 0);
}

function getTransactionDescription(tx) {
  if (tx?.description && String(tx.description).trim() !== "") {
    return tx.description;
  }

  switch (tx?.transaction_type) {
    case "reward":
      return "포인트 지급";
    case "transfer_out":
      return "학생에게 송금";
    case "transfer_in":
      return "학생에게서 송금 받음";
    default:
      return "포인트 거래";
  }
}

export default function App() {
  const todayInfo = useMemo(() => getKSTInfo(), []);
  const todayDate = todayInfo.dateStr;
  const weekend = todayInfo.weekday === "Sat" || todayInfo.weekday === "Sun";

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [userRole, setUserRole] = useState(null);

  const [currentStudent, setCurrentStudent] = useState(null);
  const [currentTeacher, setCurrentTeacher] = useState(null);

  const [studentJob, setStudentJob] = useState(null);
  const [todayTasks, setTodayTasks] = useState([]);
  const [studentViewTab, setStudentViewTab] = useState("tasks");
  const [jobGuideOpen, setJobGuideOpen] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  const [transactions, setTransactions] = useState([]);
  const [transferTargets, setTransferTargets] = useState([]);
  const [transferStudentId, setTransferStudentId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);

  const [teacherStudents, setTeacherStudents] = useState([]);
  const [teacherDashboardLoading, setTeacherDashboardLoading] = useState(false);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [teacherDetailLoading, setTeacherDetailLoading] = useState(false);
  const [batchRewardLoading, setBatchRewardLoading] = useState(false);
  const [individualRewardLoadingId, setIndividualRewardLoadingId] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;
        await hydrateFromSession(session);
      } catch (error) {
        console.error(error);
        if (mounted) {
          setAuthMessage("로그인 정보를 확인하지 못했습니다.");
        }
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hydrateFromSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function hydrateFromSession(nextSession) {
    setSession(nextSession || null);
    setAuthMessage("");

    if (!nextSession?.user) {
      setUserRole(null);
      setCurrentStudent(null);
      setCurrentTeacher(null);
      setStudentJob(null);
      setTodayTasks([]);
      setTransactions([]);
      setTransferTargets([]);
      setTeacherStudents([]);
      setSelectedStudentDetail(null);
      return;
    }

    try {
      setAppLoading(true);

      const authUserId = nextSession.user.id;

      const { data: teacherRow, error: teacherError } = await supabase
        .from("teachers")
        .select("*")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (teacherError) throw teacherError;

      if (teacherRow) {
        setUserRole("teacher");
        setCurrentTeacher(teacherRow);
        setCurrentStudent(null);
        setStudentJob(null);
        setTodayTasks([]);
        setTransactions([]);
        setTransferTargets([]);
        await loadTeacherDashboard();
        return;
      }

      const { data: studentRow, error: studentError } = await supabase
        .from("students")
        .select("*")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (studentError) throw studentError;

      if (studentRow) {
        setUserRole("student");
        setCurrentTeacher(null);
        setTeacherStudents([]);
        await loadStudentData(studentRow.id);
        return;
      }

      setUserRole(null);
      setAuthMessage("연결된 학생/교사 정보가 없어 화면을 표시할 수 없습니다.");
    } catch (error) {
      console.error(error);
      setAuthMessage(error.message || "사용자 정보를 불러오지 못했습니다.");
    } finally {
      setAppLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoginLoading(true);
    setAuthMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) throw error;
    } catch (error) {
      console.error(error);
      setAuthMessage(error.message || "로그인에 실패했습니다.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error(error);
      alert("로그아웃 중 오류가 발생했습니다.");
    }
  }

  async function loadStudentData(studentId) {
    try {
      setAppLoading(true);

      const { data: studentRow, error: studentError } = await supabase
        .from("students")
        .select("*")
        .eq("id", studentId)
        .single();

      if (studentError) throw studentError;

      setCurrentStudent(studentRow);

      let jobRow = null;
      if (studentRow.job_id) {
        const { data: jobData, error: jobError } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", studentRow.job_id)
          .single();

        if (jobError) throw jobError;
        jobRow = normalizeJob(jobData);
      }

      setStudentJob(jobRow);

      let jobTasks = [];
      if (studentRow.job_id) {
        const { data: jobTaskRows, error: taskError } = await supabase
          .from("job_tasks")
          .select("*")
          .eq("job_id", studentRow.job_id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (taskError) throw taskError;
        jobTasks = (jobTaskRows || []).slice(0, 5);
      }

      const { data: dailyCheckRows, error: checkError } = await supabase
        .from("daily_task_checks")
        .select("*")
        .eq("student_id", studentRow.id)
        .eq("task_date", todayDate);

      if (checkError) throw checkError;

      setTodayTasks(buildTodayTaskRows(jobTasks, dailyCheckRows));

      const { data: txRows, error: txError } = await supabase
        .from("point_transactions")
        .select("*")
        .eq("student_id", studentRow.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (txError) throw txError;
      setTransactions(txRows || []);

      await loadTransferTargets(studentRow.id);
    } catch (error) {
      console.error(error);
      alert(error.message || "학생 데이터를 불러오지 못했습니다.");
    } finally {
      setAppLoading(false);
    }
  }

  async function loadTransferTargets(myStudentId) {
    try {
      const { data, error } = await supabase.rpc("get_transfer_targets");

      if (error) throw error;

      const filtered = (data || []).filter(
        (item) => String(item.student_id) !== String(myStudentId)
      );

      setTransferTargets(filtered);
    } catch (error) {
      console.error("송금 대상 조회 실패:", error);
      setTransferTargets([]);
    }
  }

  async function loadTeacherDashboard() {
    try {
      setTeacherDashboardLoading(true);

      const { data: studentsRows, error: studentsError } = await supabase
        .from("students")
        .select("*")
        .order("name", { ascending: true });

      if (studentsError) throw studentsError;

      const { data: jobsRows, error: jobsError } = await supabase
        .from("jobs")
        .select("*");

      if (jobsError) throw jobsError;

      const { data: taskRows, error: taskError } = await supabase
        .from("job_tasks")
        .select("*")
        .eq("is_active", true);

      if (taskError) throw taskError;

      const { data: checkRows, error: checkError } = await supabase
        .from("daily_task_checks")
        .select("*")
        .eq("task_date", todayDate);

      if (checkError) throw checkError;

      const jobsMap = new Map(
        (jobsRows || []).map((job) => [job.id, normalizeJob(job)])
      );

      const tasksByJobId = {};
      (taskRows || []).forEach((task) => {
        if (!tasksByJobId[task.job_id]) tasksByJobId[task.job_id] = [];
        tasksByJobId[task.job_id].push(task);
      });

      const taskCountByJobId = {};
      Object.keys(tasksByJobId).forEach((jobId) => {
        taskCountByJobId[jobId] = tasksByJobId[jobId]
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
          .slice(0, 5).length;
      });

      const checkSummaryByStudentId = {};
      (checkRows || []).forEach((check) => {
        if (!checkSummaryByStudentId[check.student_id]) {
          checkSummaryByStudentId[check.student_id] = {
            completed_count: 0,
            rewarded_count: 0,
          };
        }

        if (check.checked) {
          checkSummaryByStudentId[check.student_id].completed_count += 1;
        }

        if (check.rewarded) {
          checkSummaryByStudentId[check.student_id].rewarded_count += 1;
        }
      });

      const merged = (studentsRows || []).map((student) => {
        const totalTasks = taskCountByJobId[student.job_id] || 0;
        const completedCount =
          checkSummaryByStudentId[student.id]?.completed_count || 0;
        const rewardedCount =
          checkSummaryByStudentId[student.id]?.rewarded_count || 0;

        return {
          ...student,
          job_name: jobsMap.get(student.job_id)?.name || "미배정",
          task_count: totalTasks,
          completed_count: completedCount,
          rewarded_count: rewardedCount,
          achievement_rate:
            totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0,
        };
      });

      setTeacherStudents(merged);
    } catch (error) {
      console.error(error);
      alert(error.message || "교사용 대시보드를 불러오지 못했습니다.");
    } finally {
      setTeacherDashboardLoading(false);
    }
  }

  async function loadTeacherStudentDetail(studentId) {
    try {
      setTeacherDetailLoading(true);

      const { data: studentRow, error: studentError } = await supabase
        .from("students")
        .select("*")
        .eq("id", studentId)
        .single();

      if (studentError) throw studentError;

      let jobRow = null;
      if (studentRow.job_id) {
        const { data: jobData, error: jobError } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", studentRow.job_id)
          .single();

        if (jobError) throw jobError;
        jobRow = normalizeJob(jobData);
      }

      let jobTasks = [];
      if (studentRow.job_id) {
        const { data: jobTaskRows, error: taskError } = await supabase
          .from("job_tasks")
          .select("*")
          .eq("job_id", studentRow.job_id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (taskError) throw taskError;
        jobTasks = (jobTaskRows || []).slice(0, 5);
      }

      const { data: dailyCheckRows, error: checkError } = await supabase
        .from("daily_task_checks")
        .select("*")
        .eq("student_id", studentRow.id)
        .eq("task_date", todayDate);

      if (checkError) throw checkError;

      const mergedTasks = buildTodayTaskRows(jobTasks, dailyCheckRows);

      const completedCount = mergedTasks.filter((t) => t.checked).length;
      const rewardedCount = mergedTasks.filter((t) => t.rewarded).length;

      setSelectedStudentDetail({
        student: studentRow,
        job: jobRow,
        tasks: mergedTasks,
        completedCount,
        rewardedCount,
        totalCount: mergedTasks.length,
      });
    } catch (error) {
      console.error(error);
      alert(error.message || "학생 상세 정보를 불러오지 못했습니다.");
    } finally {
      setTeacherDetailLoading(false);
    }
  }

  function handleTaskToggle(taskId) {
    if (weekend) {
      alert("주말에는 할 일을 체크하지 않습니다.");
      return;
    }

    setTodayTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;

        if (task.rewarded) {
          alert("이미 포인트가 지급된 할 일은 체크를 변경할 수 없습니다.");
          return task;
        }

        return {
          ...task,
          checked: !task.checked,
          checked_at: !task.checked ? new Date().toISOString() : null,
        };
      })
    );
  }

  async function handleSaveTodayTasks() {
    if (!currentStudent) return;

    if (weekend) {
      alert("주말에는 저장할 할 일이 없습니다.");
      return;
    }

    try {
      setSaveLoading(true);

      const payload = todayTasks
        .filter((task) => !task.rewarded)
        .filter((task) => task.daily_check_id || task.checked)
        .map((task) => ({
          student_id: currentStudent.id,
          job_task_id: task.id,
          task_date: todayDate,
          checked: task.checked,
          checked_at: task.checked ? task.checked_at || new Date().toISOString() : null,
        }));

      if (payload.length > 0) {
        const { error } = await supabase.from("daily_task_checks").upsert(payload, {
          onConflict: "student_id,job_task_id,task_date",
        });

        if (error) throw error;
      }

      await loadStudentData(currentStudent.id);
      alert("저장되었습니다.");
    } catch (error) {
      console.error(error);
      alert(error.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleTransferPoints() {
    if (!transferStudentId) {
      alert("받는 학생을 선택해주세요.");
      return;
    }

    const amount = Number(transferAmount);

    if (!amount || amount <= 0) {
      alert("송금 포인트를 1 이상 입력해주세요.");
      return;
    }

    try {
      setTransferLoading(true);

      const { error } = await supabase.rpc("transfer_points", {
        p_receiver_student_id: transferStudentId,
        p_amount: amount,
        p_note: transferNote || null,
      });

      if (error) throw error;

      setTransferStudentId("");
      setTransferAmount("");
      setTransferNote("");

      await loadStudentData(currentStudent.id);
      alert("송금이 완료되었습니다.");
    } catch (error) {
      console.error(error);
      alert(error.message || "송금 중 오류가 발생했습니다.");
    } finally {
      setTransferLoading(false);
    }
  }

  async function handleRewardStudent(studentId) {
    try {
      setIndividualRewardLoadingId(studentId);

      const { error } = await supabase.rpc("pay_completed_job_rewards_by_date", {
        p_student_id: studentId,
        p_task_date: todayDate,
      });

      if (error) throw error;

      await loadTeacherDashboard();

      if (selectedStudentDetail?.student?.id === studentId) {
        await loadTeacherStudentDetail(studentId);
      }

      alert("해당 학생의 완료 항목에 대해 포인트를 지급했습니다.");
    } catch (error) {
      console.error(error);
      alert(error.message || "개별 포인트 지급 중 오류가 발생했습니다.");
    } finally {
      setIndividualRewardLoadingId(null);
    }
  }

  async function handleBatchReward() {
    try {
      setBatchRewardLoading(true);

      const { error } = await supabase.rpc(
        "pay_all_students_completed_job_rewards_by_date",
        {
          p_task_date: todayDate,
        }
      );

      if (error) throw error;

      await loadTeacherDashboard();

      if (selectedStudentDetail?.student?.id) {
        await loadTeacherStudentDetail(selectedStudentDetail.student.id);
      }

      alert("오늘 할 일을 완료한 학생들에게 일괄 포인트를 지급했습니다.");
    } catch (error) {
      console.error(error);
      alert(error.message || "일괄 포인트 지급 중 오류가 발생했습니다.");
    } finally {
      setBatchRewardLoading(false);
    }
  }

  const completedTaskCount = todayTasks.filter((task) => task.checked).length;
  const totalTaskCount = todayTasks.length;
  const achievementRate =
    totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0;

  if (authLoading) {
    return (
      <div className="app-shell center-screen">
        <div className="loading-card">로그인 상태를 확인하는 중입니다...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell auth-bg">
        <div className="auth-card">
          <h1>우리 반 학급 앱</h1>
          <p className="auth-subtitle">학생/교사 계정으로 로그인하세요.</p>

          <form onSubmit={handleLogin} className="auth-form">
            <input
              type="email"
              placeholder="이메일"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="비밀번호"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
            <button type="submit" disabled={loginLoading}>
              {loginLoading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          {authMessage ? <div className="error-box">{authMessage}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>우리 반 학급 앱</h1>
          <p className="topbar-date">
            오늘 날짜: {todayDate} ({todayInfo.weekday})
          </p>
        </div>

        <div className="topbar-actions">
          {userRole === "student" && currentStudent && (
            <div className="user-badge">
              학생: <strong>{currentStudent.name}</strong>
            </div>
          )}

          {userRole === "teacher" && currentTeacher && (
            <div className="user-badge">
              교사: <strong>{currentTeacher.name || "선생님"}</strong>
            </div>
          )}

          <button className="logout-btn" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </header>

      {appLoading && <div className="loading-card">데이터를 불러오는 중입니다...</div>}

      {!appLoading && userRole === "student" && currentStudent && (
        <main className="page-grid">
          <section className="main-card">
            <div className="card-header-row">
              <div>
                <h2>{currentStudent.name} 학생 화면</h2>
                <p className="muted">
                  직업: <strong>{studentJob?.name || "미배정"}</strong>
                </p>
              </div>

              <div className="inline-actions">
                <button
                  className="ghost-btn"
                  onClick={() => setJobGuideOpen(true)}
                  disabled={!studentJob}
                >
                  직업 설명서
                </button>
              </div>
            </div>

            <div className="tab-row">
              <button
                className={studentViewTab === "tasks" ? "tab-btn active" : "tab-btn"}
                onClick={() => setStudentViewTab("tasks")}
              >
                오늘의 할 일
              </button>
              <button
                className={studentViewTab === "wallet" ? "tab-btn active" : "tab-btn"}
                onClick={() => setStudentViewTab("wallet")}
              >
                잔액 / 거래내역
              </button>
            </div>

            {studentViewTab === "tasks" && (
              <>
                {weekend ? (
                  <div className="weekend-box">
                    주말에는 오늘의 할 일을 진행하지 않습니다.
                  </div>
                ) : (
                  <>
                    <div className="progress-box">
                      <div className="progress-row">
                        <span>완료한 할 일</span>
                        <strong>
                          {completedTaskCount} / {totalTaskCount}
                        </strong>
                      </div>
                      <div className="progress-row">
                        <span>달성률</span>
                        <strong>{achievementRate}%</strong>
                      </div>
                    </div>

                    {todayTasks.length === 0 ? (
                      <div className="empty-box">오늘 배정된 할 일이 없습니다.</div>
                    ) : (
                      <div className="task-list">
                        {todayTasks.map((task) => (
                          <label
                            className={`task-item ${
                              task.rewarded ? "task-item-locked" : ""
                            }`}
                            key={task.id}
                          >
                            <input
                              type="checkbox"
                              checked={task.checked}
                              disabled={task.rewarded}
                              onChange={() => handleTaskToggle(task.id)}
                            />

                            <div className="task-item-content">
                              <div className="task-title-row">
                                <span className="task-title">{task.title}</span>
                                <span className="point-chip">
                                  {Number(task.point_value || 0)}P
                                </span>
                                {task.rewarded && (
                                  <span className="lock-badge">포인트 지급 완료</span>
                                )}
                              </div>

                              {task.description ? (
                                <div className="task-description">{task.description}</div>
                              ) : null}

                              {task.rewarded ? (
                                <div className="task-lock-message">
                                  이미 포인트가 지급된 항목이라 체크를 변경할 수 없습니다.
                                </div>
                              ) : null}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="action-row">
                      <button
                        className="primary-btn"
                        onClick={handleSaveTodayTasks}
                        disabled={saveLoading}
                      >
                        {saveLoading ? "저장 중..." : "오늘의 할 일 저장"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {studentViewTab === "wallet" && (
              <>
                <div className="balance-card">
                  <div className="balance-label">현재 잔액</div>
                  <div className="balance-value">
                    {Number(currentStudent.points_balance || 0)}P
                  </div>
                </div>

                <div className="transfer-card">
                  <h3>학생간 송금</h3>

                  <div className="transfer-form">
                    <select
                      value={transferStudentId}
                      onChange={(e) => setTransferStudentId(e.target.value)}
                    >
                      <option value="">받는 학생 선택</option>
                      {transferTargets.map((target) => (
                        <option key={target.student_id} value={target.student_id}>
                          {target.student_name}
                          {target.job_name ? ` (${target.job_name})` : ""}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min="1"
                      placeholder="송금할 포인트"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                    />

                    <input
                      type="text"
                      placeholder="메모(선택)"
                      value={transferNote}
                      onChange={(e) => setTransferNote(e.target.value)}
                      maxLength={50}
                    />

                    <button onClick={handleTransferPoints} disabled={transferLoading}>
                      {transferLoading ? "송금 중..." : "송금하기"}
                    </button>
                  </div>
                </div>

                <div className="section-title">거래 내역</div>

                <div className="transaction-list">
                  {transactions.length === 0 ? (
                    <div className="empty-box">거래 내역이 없습니다.</div>
                  ) : (
                    transactions.map((tx) => {
                      const amount = getTransactionAmount(tx);

                      return (
                        <div className="transaction-item" key={tx.id}>
                          <div className="transaction-main">
                            <span className="transaction-type">
                              {getTransactionLabel(tx)}
                            </span>
                            <span className={amount >= 0 ? "plus" : "minus"}>
                              {amount >= 0 ? "+" : ""}
                              {amount}P
                            </span>
                          </div>

                          <div className="transaction-sub">
                            <span>{getTransactionDescription(tx)}</span>
                            {tx.note ? <span> · {tx.note}</span> : null}
                          </div>

                          <div className="transaction-date">
                            {tx.created_at
                              ? new Date(tx.created_at).toLocaleString("ko-KR")
                              : "-"}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>
        </main>
      )}

      {!appLoading && userRole === "teacher" && (
        <main className="page-grid teacher-layout">
          <section className="main-card">
            <div className="card-header-row">
              <div>
                <h2>교사용 관리자 페이지</h2>
                <p className="muted">학생별 오늘의 할 일 달성 현황</p>
              </div>

              <div className="inline-actions">
                <button
                  className="primary-btn"
                  onClick={handleBatchReward}
                  disabled={batchRewardLoading || weekend}
                >
                  {batchRewardLoading
                    ? "일괄 지급 중..."
                    : "할 일 완료 학생 포인트 일괄 지급"}
                </button>
              </div>
            </div>

            {weekend && (
              <div className="weekend-box">
                주말에는 오늘의 할 일을 진행하지 않으므로 포인트 지급도 사용하지 않는 것을 권장합니다.
              </div>
            )}

            {teacherDashboardLoading ? (
              <div className="loading-card slim">학생 목록을 불러오는 중입니다...</div>
            ) : (
              <div className="teacher-student-list">
                {teacherStudents.map((student) => (
                  <div className="teacher-student-card" key={student.id}>
                    <div className="teacher-student-top">
                      <div>
                        <div className="teacher-student-name">{student.name}</div>
                        <div className="teacher-student-job">{student.job_name}</div>
                      </div>

                      <div className="teacher-balance">
                        잔액 {Number(student.points_balance || 0)}P
                      </div>
                    </div>

                    <div className="teacher-stats">
                      <div>완료: {student.completed_count}개</div>
                      <div>지급 완료: {student.rewarded_count}개</div>
                      <div>전체: {student.task_count}개</div>
                      <div>달성률: {student.achievement_rate}%</div>
                    </div>

                    <div className="teacher-card-actions">
                      <button
                        className="ghost-btn"
                        onClick={() => loadTeacherStudentDetail(student.id)}
                      >
                        상세보기
                      </button>

                      <button
                        className="secondary-btn"
                        onClick={() => handleRewardStudent(student.id)}
                        disabled={individualRewardLoadingId === student.id || weekend}
                      >
                        {individualRewardLoadingId === student.id
                          ? "지급 중..."
                          : "개별 포인트 지급"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="side-card">
            <h3>학생 상세 정보</h3>

            {teacherDetailLoading ? (
              <div className="loading-card slim">상세 정보를 불러오는 중입니다...</div>
            ) : !selectedStudentDetail ? (
              <div className="empty-box">왼쪽 목록에서 학생을 선택해주세요.</div>
            ) : (
              <>
                <div className="detail-summary">
                  <div>
                    <strong>{selectedStudentDetail.student.name}</strong>
                  </div>
                  <div className="muted">
                    직업: {selectedStudentDetail.job?.name || "미배정"}
                  </div>
                  <div className="muted">
                    잔액: {Number(selectedStudentDetail.student.points_balance || 0)}P
                  </div>
                  <div className="muted">
                    완료 {selectedStudentDetail.completedCount} /{" "}
                    {selectedStudentDetail.totalCount} · 지급완료{" "}
                    {selectedStudentDetail.rewardedCount}개
                  </div>
                </div>

                {selectedStudentDetail.job?.resolvedDescription ? (
                  <div className="job-guide-mini">
                    {selectedStudentDetail.job.resolvedDescription}
                  </div>
                ) : null}

                <div className="detail-task-list">
                  {selectedStudentDetail.tasks.length === 0 ? (
                    <div className="empty-box">배정된 할 일이 없습니다.</div>
                  ) : (
                    selectedStudentDetail.tasks.map((task) => (
                      <div
                        className={`detail-task-item ${
                          task.rewarded ? "detail-task-item-locked" : ""
                        }`}
                        key={task.id}
                      >
                        <div className="detail-task-top">
                          <span className="detail-task-title">{task.title}</span>
                          <span className="point-chip">
                            {Number(task.point_value || 0)}P
                          </span>
                        </div>

                        {task.description ? (
                          <div className="detail-task-desc">{task.description}</div>
                        ) : null}

                        <div className="detail-task-meta">
                          <span>{task.checked ? "완료" : "미완료"}</span>

                          {task.checked_at ? (
                            <span>
                              체크 시각: {new Date(task.checked_at).toLocaleString("ko-KR")}
                            </span>
                          ) : null}

                          {task.rewarded ? (
                            <span className="rewarded-text">포인트 지급 완료</span>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </aside>
        </main>
      )}

      {!appLoading && !userRole && session && (
        <main className="page-grid">
          <section className="main-card">
            <div className="error-box">
              연결된 학생/교사 정보가 없어 화면을 표시할 수 없습니다.
            </div>
          </section>
        </main>
      )}

      {jobGuideOpen && (
        <div className="modal-backdrop" onClick={() => setJobGuideOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{studentJob?.resolvedManualTitle || "직업 설명서"}</h3>
              <button className="icon-btn" onClick={() => setJobGuideOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="job-name-large">{studentJob?.name || "직업 정보 없음"}</div>
              <div className="job-desc-large">
                {studentJob?.resolvedDescription || "등록된 직업 설명이 없습니다."}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

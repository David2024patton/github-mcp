Third bug found by real-account acceptance (stacked-PR merge on a scratch fixture): github_workflow_merge_stack asked the PR timeline for 300 events but the
timeline tool allows at most 100, so the call was refused and every stack stopped at "base-change history is unreadable or incomplete" before merging anything.
Unit tests used a mocked call that accepted any value. Fixed to 100 (a longer history still fails closed through the existing more_exist rule), and the conveyor
test now checks the argument against the real tool schema. A scan of the other workflow files for the same pattern (max above the tool schema) found none.

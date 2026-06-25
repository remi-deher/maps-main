package enroller

import "testing"

func TestRequestValidate(t *testing.T) {
	cases := []struct {
		name    string
		req     Request
		wantErr bool
	}{
		{"valid", Request{UDID: "abc", DeviceRecord: "ZGF0YQ=="}, false},
		{"missing udid", Request{DeviceRecord: "ZGF0YQ=="}, true},
		{"missing record", Request{UDID: "abc"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.req.Validate()
			if (err != nil) != tc.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestEnrollRejectsPathTraversal(t *testing.T) {
	for _, udid := range []string{"..", ".", "/", "\\"} {
		if _, err := Enroll(Request{UDID: udid, DeviceRecord: "ZGF0YQ=="}); err == nil {
			t.Errorf("Enroll(udid=%q) expected error, got nil", udid)
		}
	}
}

func TestEnrollRejectsInvalidBase64(t *testing.T) {
	if _, err := Enroll(Request{UDID: "abc", DeviceRecord: "not-base64!"}); err == nil {
		t.Error("Enroll() with invalid base64 expected error, got nil")
	}
}
